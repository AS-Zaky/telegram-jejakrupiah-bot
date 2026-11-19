import { getBot } from '../src/bot/bot.js';
import { runDailyRecap } from '../src/services/scheduler.js';
import { logError } from '../src/utils/log.js';

/**
 * Entry point cron Vercel (dijadwalkan `vercel.json` pukul 13:00 UTC).
 * `runDailyRecap` sudah melewati hari yang bukan akhir bulan, jadi aman
 * dipanggil tiap hari.
 */
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  try {
    const result = await runDailyRecap(getBot());
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) {
    // Cron tidak punya user untuk dibalas; cukup log + status gagal.
    logError('[CRON]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'internal error' }));
  }
}
