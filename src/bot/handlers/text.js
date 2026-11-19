import * as repo from '../../db/repo.js';
import { config } from '../../config.js';
import { extractFromText } from '../../services/gemini.js';
import { userMessage } from '../../services/errors.js';
import { todayISO } from '../../utils/format.js';
import { log, logError } from '../../utils/log.js';
import { normalizeExtraction } from '../../utils/validate.js';
import { confirmKeyboard, PARSE_MODE, previewText } from '../views.js';

/** Simpan PENDING + kirim kartu konfirmasi. Dipakai teks & foto. */
export async function offerConfirmation(ctx, raw) {
  log('[EXTRACT]', 'Validasi hasil ekstraksi...');
  const extraction = normalizeExtraction(raw, todayISO(config.timezone));

  log('[DB]', 'Menyimpan transaksi PENDING ke PostgreSQL...');
  const id = await repo.createPending(ctx.from.id, extraction);
  log('[DB]', `Tersimpan dengan id=${id}`);

  log('[TG]', 'Mengirim kartu konfirmasi...');
  await ctx.reply(previewText(extraction), {
    ...PARSE_MODE,
    reply_parameters: { message_id: ctx.msg.message_id },
    reply_markup: confirmKeyboard(id),
  });
  log('[TG]', 'Kartu konfirmasi terkirim.');
}

export async function onText(ctx) {
  const text = ctx.msg.text?.trim();
  if (!text) return;
  if (text.startsWith('/')) {
    log('[TEXT]', `Lewati command: ${text}`);
    return;
  }

  log('[TEXT]', `Menerima pesan dari userId=${ctx.from.id}: "${text}"`);
  try {
    await ctx.replyWithChatAction('typing');
    const raw = await extractFromText(text, todayISO(config.timezone));
    await offerConfirmation(ctx, raw);
  } catch (error) {
    logError('[ERROR]', error);
    await ctx
      .reply(userMessage(error), PARSE_MODE)
      .catch((sendError) => logError('[ERROR] gagal kirim pesan error:', sendError));
  }
}
