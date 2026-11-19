import cron from 'node-cron';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { reportText, PARSE_MODE } from '../bot/views.js';
import { parsePeriod, todayISO } from '../utils/format.js';
import { log, logError } from '../utils/log.js';

/**
 * Tanggal `YYYY-MM-DD` bergeser `days` hari menurut kalender, berbasis string
 * supaya tidak kena pergeseran zona waktu server.
 * @param {string} isoDate
 * @param {number} days
 */
function shiftDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Hari terakhir bulan? Cek tanggal besok menurut timezone app:
 * kalau besok tanggal 1, hari ini hari terakhir bulan.
 * @param {string} today `YYYY-MM-DD`
 */
export function isLastDayOfMonth(today) {
  return shiftDate(today, 1).endsWith('-01');
}

/**
 * Pesan rekap otomatis: header + view rekap yang sama dengan /rekap.
 * @param {string} label `YYYY-MM`
 * @param {Array<{ type: string, category: string, total: string, count: number }>} rows
 */
export function buildMonthlyRecapMessage(label, rows) {
  const { label: periodLabel } = parsePeriod(label, `${label}-01`);
  const income = rows.filter((r) => r.type === 'INCOME');
  const expense = rows.filter((r) => r.type === 'EXPENSE');
  return `📅 <b>Rekap Otomatis Akhir Bulan</b>\n\n${reportText(periodLabel, income, expense, expense)}`;
}

/**
 * Kirim rekap satu user. Error dibiarkan naik supaya pemanggil mencatat
 * dan lanjut ke user berikutnya.
 * @param {{ api: { sendMessage: Function } }} bot
 * @param {number | string} userId
 * @param {string} period `YYYY-MM`
 */
async function sendRecap(bot, userId, period) {
  const { from, to } = parsePeriod(period, `${period}-01`);
  const rows = await repo.monthlyTotals(userId, from, to);
  await bot.api.sendMessage(userId, buildMonthlyRecapMessage(period, rows), PARSE_MODE);
}

/**
 * Tugas harian: query DB hanya kalau hari ini hari terakhir bulan.
 * @param {{ api: { sendMessage: Function } }} bot
 * @param {string} [today] untuk test
 */
export async function runDailyRecap(bot, today = todayISO(config.timezone)) {
  if (!isLastDayOfMonth(today)) return { skipped: true, sent: 0, failed: 0 };

  const period = today.slice(0, 7);
  const ids = [...config.allowedIds];

  if (ids.length === 0) {
    log('[CRON]', 'Akhir bulan tapi ALLOWED_TELEGRAM_IDS kosong — tidak ada tujuan rekap.');
    return { skipped: false, sent: 0, failed: 0 };
  }

  log('[CRON]', `Akhir bulan (${today}) — kirim rekap ke ${ids.length} user.`);
  let sent = 0;
  let failed = 0;

  for (const userId of ids) {
    try {
      await sendRecap(bot, userId, period);
      sent += 1;
      log('[CRON]', `Rekap terkirim ke userId=${userId}`);
    } catch (error) {
      // Satu user gagal (blocked bot, DB error) tidak boleh menghentikan sisanya.
      failed += 1;
      logError('[CRON]', `Gagal kirim rekap ke userId=${userId}: ${error?.message ?? error}`);
    }
  }

  log('[CRON]', `Selesai. terkirim=${sent} gagal=${failed}`);
  return { skipped: false, sent, failed };
}

/**
 * Jadwalkan tugas harian 20:00 waktu app.
 * @param {{ api: { sendMessage: Function } }} bot
 * @returns {{ stop: () => void }}
 */
export function startMonthlyRecapScheduler(bot) {
  const task = cron.schedule(
    '0 20 * * *',
    () => {
      runDailyRecap(bot).catch((error) => logError('[CRON]', error));
    },
    { timezone: config.timezone },
  );

  log('[CRON]', `Scheduler rekap aktif (0 20 * * *, timezone=${config.timezone})`);
  return task;
}
