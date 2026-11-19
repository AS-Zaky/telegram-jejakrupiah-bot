import { config } from '../../config.js';
import { extractFromReceipt } from '../../services/gemini.js';
import { GeminiError, userMessage } from '../../services/errors.js';
import { todayISO } from '../../utils/format.js';
import { log, logError } from '../../utils/log.js';
import { resolveMime } from '../../utils/mime.js';
import { offerConfirmation } from './text.js';
import { PARSE_MODE } from '../views.js';

/** Batas unduh: foto Telegram maksimal 20MB, dokumen juga. */
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Ukuran tertinggi = file_size terbesar (jangan andalkan urutan array). */
function largest(photos) {
  return photos.reduce((best, p) => ((p.file_size ?? 0) > (best.file_size ?? 0) ? p : best));
}

/**
 * Jalan bersama pesan foto & dokumen.
 * Telegram sering mengirim `content-type: application/octet-stream`, jadi MIME
 * ditentukan magic bytes -> header valid -> ekstensi file_path.
 */
async function handleMedia(ctx, { fileId, declaredMime, label }) {
  log('[PHOTO]', `Menerima ${label} dari userId=${ctx.from.id}`);

  try {
    await ctx.replyWithChatAction('typing');

    const file = await ctx.api.getFile(fileId);
    log('[TG]', `file_path=${file.file_path}`);

    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`unduh file gagal (HTTP ${response.status})`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const header = response.headers.get('content-type');
    log('[TG]', `Terunduh: ${buffer.length} byte, content-type=${header ?? '-'}`);

    const mimeType = resolveMime(buffer, header ?? declaredMime, file.file_path);
    if (!mimeType) {
      throw new GeminiError('not_transaction', 'Format file tidak dikenali. Kirim JPG/PNG/WebP/PDF.');
    }    log('[MIME]', `mimeType=${mimeType} (header=${header ?? '-'}, path=${file.file_path})`);

    const raw = await extractFromReceipt(
      buffer,
      mimeType,
      todayISO(config.timezone),
      ctx.msg.caption?.trim(),
    );
    await offerConfirmation(ctx, raw);
  } catch (error) {
    logError('[ERROR]', error);
    await ctx
      .reply(userMessage(error), PARSE_MODE)
      .catch((sendError) => logError('[ERROR] gagal kirim pesan error:', sendError));
  }
}

export async function onPhoto(ctx) {
  const photos = ctx.msg.photo;
  if (!photos?.length) return;

  const best = largest(photos);
  log('[PHOTO]', `Resolusi ${best.width}x${best.height}, file_id=${best.file_id}`);

  // Foto Telegram selalu JPEG di sisi server; magic bytes tetap diverifikasi.
  await handleMedia(ctx, { fileId: best.file_id, declaredMime: 'image/jpeg', label: 'foto' });
}

/** Dokumen: hanya diproses kalau gambar atau PDF. */
export async function onDocument(ctx) {
  const doc = ctx.msg.document;
  if (!doc) return;

  const declared = String(doc.mime_type ?? '').toLowerCase();
  if (!declared.startsWith('image/') && declared !== 'application/pdf') {
    log('[PHOTO]', `Dokumen dilewati (mime_type=${declared || 'kosong'})`);
    return;
  }

  await handleMedia(ctx, {
    fileId: doc.file_id,
    declaredMime: declared,
    label: `dokumen ${doc.file_name ?? ''}`.trim(),
  });
}
