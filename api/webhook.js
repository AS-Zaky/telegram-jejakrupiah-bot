import { webhookCallback } from 'grammy';
import { getBot } from '../src/bot/bot.js';

/**
 * Entry point webhook Vercel (Node.js runtime, bukan edge: grammy butuh `http`).
 * Cold start menyiapkan bot sekali; warm invocation memakai instance yang sama
 * karena modul di-cache selama container hidup.
 */
let cachedHandler;

function getHandler() {
  // Token & secret dibaca saat request pertama, bukan saat modul dievaluasi,
  // supaya `GET` (health check) tidak butuh env apa pun.
  return (cachedHandler ??= webhookCallback(getBot(), 'http', {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
  }));
}

export default async function handler(req, res) {
  // Plain Node handler: Vercel tidak menyediakan res.status().json() seperti Next.js.
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, service: 'jejakrupiah-webhook' }));
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, POST');
    res.end();
    return;
  }

  await getHandler()(req, res);
}
