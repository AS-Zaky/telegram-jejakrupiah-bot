/**
 * @typedef {'INCOME' | 'EXPENSE'} TxType
 * @typedef {object} Extraction
 * @property {TxType} type
 * @property {number} amount
 * @property {string} category
 * @property {string} note
 * @property {string} transaction_date
 */

class ConfigError extends Error {}

/** Lazy + memoized: `npm run migrate` cuma butuh DATABASE_URL. */
function memo(fn) {
  let cached;
  return () => (cached ??= fn());
}

function required(name, read) {
  return memo(() => {
    const value = read()?.trim();
    if (!value) throw new ConfigError(`Env ${name} belum diisi (lihat .env.example)`);
    return value;
  });
}

/** Kosong = semua user diizinkan. */
const allowedIds = memo(() => {
  const ids = (process.env.ALLOWED_TELEGRAM_IDS ?? '')
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const id of ids) {
    if (!/^\d+$/.test(id)) throw new ConfigError(`ALLOWED_TELEGRAM_IDS bukan angka: "${id}"`);
  }
  return new Set(ids);
});

export const config = {
  get telegramToken() {
    return required('TELEGRAM_BOT_TOKEN', () => process.env.TELEGRAM_BOT_TOKEN)();
  },
  get geminiApiKey() {
    return required('GEMINI_API_KEY', () => process.env.GEMINI_API_KEY)();
  },
  get databaseUrl() {
    return required('DATABASE_URL', () => process.env.DATABASE_URL)();
  },
  get allowedIds() {
    return allowedIds();
  },
  get timezone() {
    return process.env.APP_TIMEZONE?.trim() || 'Asia/Jakarta';
  },
  /** Diganti lewat GEMINI_MODEL tanpa ubah kode; default ikut model yang tersedia di API. */
  get model() {
    return process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  },
  /** Dipakai kalau model utama habis retry karena 503/5xx. */
  get fallbackModel() {
    return process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-3.8-flash-lite';
  },
};
