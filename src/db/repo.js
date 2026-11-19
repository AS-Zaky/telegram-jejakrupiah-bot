import { getPool } from './pool.js';

const db = () => getPool();

/** @param {number | string} userId @param {import('../config.js').Extraction} tx */
export async function createPending(userId, tx) {
  const { rows } = await db().query(
    `INSERT INTO transactions (telegram_user_id, type, amount, category, note, status, transaction_date)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
     RETURNING id`,
    [userId, tx.type, tx.amount, tx.category, tx.note, tx.transaction_date],
  );
  return rows[0].id;
}

/** Ownership + status ikut masuk WHERE: user lain tidak bisa konfirmasi record ini. */
export async function confirmPending(id, userId) {
  const { rows } = await db().query(
    `UPDATE transactions SET status = 'CONFIRMED'
     WHERE id = $1 AND telegram_user_id = $2 AND status = 'PENDING'
     RETURNING id, type, amount, category, note, transaction_date`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function cancelPending(id, userId) {
  const { rows } = await db().query(
    `DELETE FROM transactions
     WHERE id = $1 AND telegram_user_id = $2 AND status = 'PENDING'
     RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Transaksi CONFIRMED terbaru milik user — bahan command /hapus. */
export async function getLastConfirmedTransaction(userId) {
  const { rows } = await db().query(
    `SELECT id, type, amount, category, note, transaction_date
     FROM transactions
     WHERE telegram_user_id = $1 AND status = 'CONFIRMED'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Batas atas /riwayat: query tanpa LIMIT wajar bisa membanjiri Telegram. */
export const HISTORY_MAX = 50;

/** @param {unknown} limit */
export function clampHistoryLimit(limit) {
  // `Number(x) || 10` membuat 0 diam-diam jadi 10; 0 harus tetap berarti 1.
  const value = Number(limit);
  if (!Number.isFinite(value) || value === 0) return limit === 0 || limit === '0' ? 1 : 10;
  return Math.min(Math.max(1, Math.trunc(value)), HISTORY_MAX);
}

/**
 * Transaksi CONFIRMED terbaru, urut tanggal lalu waktu input.
 * @param {number | string} userId
 * @param {{ limit?: number, type?: 'INCOME' | 'EXPENSE' | null }} [options]
 */
export async function getRecentTransactions(userId, { limit = 10, type = null } = {}) {
  const size = clampHistoryLimit(limit);
  const filter = type === 'INCOME' || type === 'EXPENSE' ? type : null;

  const { rows } = await db().query(
    `SELECT id, type, amount, category, note, transaction_date
     FROM transactions
     WHERE telegram_user_id = $1 AND status = 'CONFIRMED'
       AND ($2::text IS NULL OR type = $2)
     ORDER BY transaction_date DESC, created_at DESC, id DESC
     LIMIT $3`,
    [userId, filter, size],
  );
  return rows;
}

/**
 * Hapus permanen satu transaksi CONFIRMED milik user.
 * Ownership + status di WHERE: user lain / record PENDING tidak bisa disentuh.
 */
export async function deleteConfirmedTransaction(id, userId) {
  const { rows } = await db().query(
    `DELETE FROM transactions
     WHERE id = $1 AND telegram_user_id = $2 AND status = 'CONFIRMED'
     RETURNING id, type, amount, category, note, transaction_date`,
    [id, userId],
  );
  return rows[0] ?? null;
}

/** @returns {Promise<Array<{ type: string, category: string, total: string, count: number }>>} */
export async function monthlyTotals(userId, from, to) {
  const { rows } = await db().query(
    `SELECT type, category, SUM(amount)::text AS total, COUNT(*)::int AS count
     FROM transactions
     WHERE telegram_user_id = $1 AND status = 'CONFIRMED'
       AND transaction_date >= $2 AND transaction_date < $3
     GROUP BY type, category
     ORDER BY type, SUM(amount) DESC`,
    [userId, from, to],
  );
  return rows;
}

export async function confirmedBetween(userId, from, to) {
  const { rows } = await db().query(
    `SELECT id, type, amount, category, note, transaction_date
     FROM transactions
     WHERE telegram_user_id = $1 AND status = 'CONFIRMED'
       AND transaction_date >= $2 AND transaction_date < $3
     ORDER BY transaction_date, id`,
    [userId, from, to],
  );
  return rows;
}
