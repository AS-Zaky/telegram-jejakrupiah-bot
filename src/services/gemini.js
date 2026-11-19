import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { CATEGORIES } from '../utils/constants.js';
import { log, logError, sleep } from '../utils/log.js';
import { GeminiError } from './errors.js';

/** Batas keras satu request: tanpa ini socket nyangkut = promise tak pernah settle. */
const TIMEOUT_MS = 20_000;

/** Jeda retry: 1.5s -> 3s -> 5s, total 3 percobaan ulang di model yang sama. */
export const RETRY_DELAYS_MS = [1_500, 3_000, 5_000];

/** Retryable: 503 UNAVAILABLE, 429 kuota, 5xx transient, timeout, socket mati. */
function isRetryable(error) {
  const status = error?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
  const message = String(error?.message ?? error).toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

const isAbort = (error) => error?.name === 'TimeoutError' || error?.name === 'AbortError';
const statusOf = (error) => (typeof error?.status === 'number' ? ` ${error.status}` : '');

export const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/** Structured output: kunci + enum dikunci di schema, bukan di prompt. */
export const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      enum: ['INCOME', 'EXPENSE'],
      description: 'INCOME untuk uang masuk, EXPENSE untuk uang keluar.',
    },
    amount: {
      type: Type.NUMBER,
      description:
        'Nominal total dalam Rupiah, angka murni tanpa titik/koma. Contoh "Rp 25.000" -> 25000.',
    },
    category: { type: Type.STRING, enum: CATEGORIES },
    note: {
      type: Type.STRING,
      description: 'Ringkasan singkat transaksi, maksimal 120 karakter.',
    },
    transaction_date: {
      type: Type.STRING,
      description: 'Tanggal transaksi format YYYY-MM-DD. Pakai tanggal hari ini jika tidak disebut.',
    },
  },
  required: ['type', 'amount', 'category', 'note', 'transaction_date'],
};

export const responseConfig = {
  responseMimeType: 'application/json',
  responseSchema: extractionSchema,
};

/** Satu panggilan HTTP ke satu model, tanpa retry internal SDK. */
async function callModel(model, contents) {
  const started = Date.now();
  log('[GEMINI]', `Memanggil model ${model} (timeout ${TIMEOUT_MS}ms)...`);

  // Gemini menolak mimeType di luar image/* dan application/pdf: gagal cepat
  // lebih baik daripada 400 INVALID_ARGUMENT dari API.
  for (const part of Array.isArray(contents) ? contents : []) {
    const mime = part?.inlineData?.mimeType;
    if (mime === undefined) continue;
    if (!/^image\//.test(mime) && mime !== 'application/pdf') {
      throw new GeminiError('failed', `MIME type tidak didukung Gemini: ${mime}`);
    }
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      ...responseConfig,
      temperature: 0,
      systemInstruction:
        'Kamu mesin ekstraksi data transaksi keuangan Indonesia. Balas hanya JSON sesuai schema. ' +
        'Jangan bertanya, jangan menambah penjelasan. Kalau bukan transaksi keuangan, tetap isi field ' +
        'sebisanya dengan asumsi terbaik.',
      // Tiga lapis pengaman: abort di sisi client, timeout SDK, tanpa retry SDK
      // (retry diatur sendiri di sini supaya backoff + fallback kelihatan di log).
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } },
    },
  });

  const elapsed = Date.now() - started;
  log('[GEMINI]', `Response diterima dari ${model} dalam ${elapsed}ms:`);

  const text = response.text;
  if (!text) {
    logError('[GEMINI]', 'Response tanpa teks. Full response: ' + JSON.stringify(response));
    throw new GeminiError('empty', 'Gemini mengembalikan respons kosong');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    logError('[GEMINI]', `Bukan JSON valid: ${text}`);
    throw new GeminiError('invalid_json', 'Gemini mengembalikan JSON yang tidak valid');
  }

  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

/** Retry berjenjang untuk satu model. Throw error terakhir kalau semua gagal. */
async function callWithRetry(model, contents) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (attempt > 0) log('[GEMINI]', `Percobaan ke-${attempt + 1} pada ${model}`);
      return await callModel(model, contents);
    } catch (error) {
      if (isAbort(error)) {
        throw new GeminiError('timeout', `Gemini tidak merespons dalam ${TIMEOUT_MS}ms (model ${model})`, error);
      }
      if (!isRetryable(error) || attempt >= RETRY_DELAYS_MS.length) throw error;

      const wait = RETRY_DELAYS_MS[attempt];
      log(
        '[GEMINI]',
        `Retry ke-${attempt + 1} karena${statusOf(error)}${
          error?.status ? '' : ` ${error?.message ?? error}`
        } — tunggu ${wait}ms...`,
      );
      await sleep(wait);
    }
  }
}

/** @returns {Promise<Record<string, unknown>>} */
async function extract(contents) {
  const primary = config.model;
  try {
    return await callWithRetry(primary, contents);
  } catch (error) {
    if (isAbort(error)) {
      throw new GeminiError('timeout', `Gemini tidak merespons dalam ${TIMEOUT_MS}ms (model ${primary})`, error);
    }
    if (!isRetryable(error)) {
      throw new GeminiError('failed', `Gemini gagal: ${error?.message ?? error}`, error);
    }

    const fallback = config.fallbackModel;
    if (!fallback || fallback === primary) {
      logError('[GEMINI]', `Model ${primary} gagal total${statusOf(error)}, tidak ada fallback.`);
      throw new GeminiError('busy', `Model ${primary} sedang sibuk${statusOf(error)}`, error);
    }

    log('[GEMINI]', `Model ${primary} gagal total${statusOf(error)} — fallback ke ${fallback}`);
    try {
      return await callWithRetry(fallback, contents);
    } catch (fallbackError) {
      if (isAbort(fallbackError)) {
        throw new GeminiError(
          'timeout',
          `Gemini tidak merespons dalam ${TIMEOUT_MS}ms (model ${fallback})`,
          fallbackError,
        );
      }
      if (!isRetryable(fallbackError)) {
        throw new GeminiError('failed', `Gemini gagal: ${fallbackError?.message ?? fallbackError}`, fallbackError);
      }
      logError('[GEMINI]', `Fallback ${fallback} juga gagal${statusOf(fallbackError)}.`);
      throw new GeminiError('busy', `Model ${primary} dan ${fallback} sedang sibuk`, fallbackError);
    }
  }
}

/** @param {string} text @param {string} today */
export function extractFromText(text, today) {
  return extract(
    `Tanggal hari ini: ${today}.\n` +
      `Ekstrak transaksi dari pesan berikut.\n` +
      `<pesan>\n${text}\n</pesan>`,
  );
}

/** @param {Buffer} image @param {string} mimeType @param {string} today @param {string} [caption] */
export function extractFromReceipt(image, mimeType, today, caption) {
  return extract([
    {
      text:
        `Tanggal hari ini: ${today}.\n` +
        'Ekstrak transaksi dari foto struk/nota berikut.\n' +
        'Aturan amount: pakai GRAND TOTAL / TOTAL BAYAR akhir setelah diskon, service charge, dan pajak. ' +
        'Jangan pakai subtotal, jangan pakai nominal uang bayar atau kembalian.\n' +
        'Aturan note: isi ringkasan item yang dibeli (misal "Belanja bulanan: beras, telur, minyak").\n' +
        'Aturan type: struk/nota belanja selalu EXPENSE.' +
        (caption ? `\nCatatan dari user: ${caption}` : ''),
    },
    { inlineData: { mimeType, data: image.toString('base64') } },
  ]);
}
