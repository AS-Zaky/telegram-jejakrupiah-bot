import { Bot } from 'grammy';
import { config } from '../config.js';
import { log, logError } from '../utils/log.js';
import { onCallback, onExport, onHapus, onRekap, onRiwayat, onStart } from './handlers/commands.js';
import { onDocument, onPhoto } from './handlers/photo.js';
import { onText } from './handlers/text.js';
import { whitelist } from './middleware.js';

export function createBot() {
  const bot = new Bot(config.telegramToken);

  bot.use(whitelist());

  // Timer: kalau handler menggantung > 30s, ketahuan di log (bukan diam-diam).
  bot.use(async (ctx, next) => {
    const started = Date.now();
    const who = ctx.from?.id ?? 'unknown';
    const what = ctx.callbackQuery ? `callback ${ctx.callbackQuery.data}` : ctx.message?.text ?? 'non-text';
    const timer = setTimeout(
      () => logError('[HANG]', `handler >30s dari userId=${who} (${what}). Cek Gemini/PostgreSQL.`),
      30_000,
    );
    try {
      await next();
    } finally {
      clearTimeout(timer);
      log('[TG]', `selesai ${Date.now() - started}ms — ${what}`);
    }
  });

  bot.command('start', onStart);
  bot.command('help', onStart);
  bot.command('rekap', onRekap);
  bot.command('riwayat', onRiwayat);
  bot.command('export', onExport);
  bot.command('hapus', onHapus);
  bot.on('callback_query:data', onCallback);
  bot.on('message:photo', onPhoto);
  bot.on('message:document', onDocument);
  bot.on('message:text', onText);

  bot.catch((error) => {
    logError('[BOT ERROR]', error.error ?? error);
    if (error.ctx) {
      logError(
        '[BOT ERROR] context:',
        `update_id=${error.ctx.update.update_id} userId=${error.ctx.from?.id} chatId=${error.ctx.chat?.id}`,
      );
    }
  });

  return bot;
}

/**
 * Instance tunggal untuk semua entry point (long polling lokal & webhook Vercel).
 * Memanggil `setWebhook`/`getMe` tidak terjadi di sini, jadi aman tanpa network.
 */
let shared;

export function getBot() {
  return (shared ??= createBot());
}
