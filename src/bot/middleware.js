import { config } from '../config.js';
import { denialText, PARSE_MODE } from './views.js';

/** Whitelist global: pesan + callback dari ID tak terdaftar ditolak di satu tempat. */
export function whitelist() {
  return async (ctx, next) => {
    const allowed = config.allowedIds;
    if (allowed.size === 0) return next();

    const userId = ctx.from?.id;
    if (userId !== undefined && allowed.has(String(userId))) return next();

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Akses ditolak.', show_alert: true }).catch(() => {});
      return;
    }
    await ctx.reply(denialText(userId ?? 'tidak diketahui'), PARSE_MODE).catch(() => {});
  };
}
