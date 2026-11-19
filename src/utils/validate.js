import { CATEGORIES, FALLBACK_CATEGORY } from './constants.js';
import { GeminiError } from '../services/errors.js';

/** Validasi kalender + tolak tanggal masa depan (halusinasi model). */
function safeDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return today;
  return value > today ? today : value;
}

/**
 * Trust boundary: output Gemini tidak pernah dipercaya mentah-mentah.
 * @param {unknown} raw
 * @param {string} today `YYYY-MM-DD`
 * @returns {import('../config.js').Extraction}
 */
export function normalizeExtraction(raw, today) {
  const data = /** @type {Record<string, unknown>} */ (raw ?? {});

  const type = String(data.type ?? '').trim().toUpperCase();
  if (type !== 'INCOME' && type !== 'EXPENSE') {
    throw new GeminiError('not_transaction', 'Transaksi tidak terdeteksi. Coba tulis lebih spesifik.');
  }

  const amount = Math.round(Number(data.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new GeminiError('not_transaction', 'Nominal transaksi tidak terbaca dengan jelas.');
  }
  if (amount > 9_999_999_999_999.99) {
    throw new GeminiError('not_transaction', 'Nominal terlalu besar untuk dicatat.');
  }

  const category = CATEGORIES.includes(String(data.category).trim())
    ? String(data.category).trim()
    : FALLBACK_CATEGORY;

  const note = String(data.note ?? '').trim().slice(0, 500);

  return { type, amount, category, note, transaction_date: safeDate(data.transaction_date, today) };
}
