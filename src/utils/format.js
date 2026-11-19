import { MONTHS_ID } from './constants.js';

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/** @param {number | string} value */
export function formatRupiah(value) {
  return rupiah.format(Number(value) || 0);
}

/** `YYYY-MM-DD` hari ini menurut timezone aplikasi. */
export function todayISO(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Amankan teks user sebelum masuk parse_mode HTML Telegram.
 * Telegram hanya mengenal 3 entity (& < >), tapi kutip ikut di-escape karena
 * murah dan membuat hasil ini aman dipakai di atribut HTML lain.
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Total rata kanan per baris (monospace). Lebar dihitung dari string yang sudah
 * di-escape, jadi entity seperti `&amp;` tetap dihitung 5 karakter — sesuai
 * yang tampil di blok `<pre>`.
 * @param {Array<[string, string]>} pairs
 */
export function alignTotals(pairs) {
  if (pairs.length === 0) return [];
  const labelWidth = Math.max(...pairs.map(([label]) => label.length));
  const valueWidth = Math.max(...pairs.map(([, value]) => value.length));
  return pairs.map(
    ([label, value]) =>
      `${label.padEnd(labelWidth)} : ${value.padStart(valueWidth)}`,
  );
}

/**
 * Tanggal rapi untuk pesan: `19 Nov 2026`.
 * Menerima Date (dari pg `RETURNING`), `YYYY-MM-DD` (dari Gemini), atau timestamp ISO.
 * @param {Date | string} value
 * @param {string} timeZone
 */
export function formatDate(value, timeZone) {
  let date;
  if (value instanceof Date) {
    date = value;
  } else {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    // "2026-11-19" saja -> interpretasi UTC, bukan tengah malam lokal server.
    date = /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00Z`)
      : // "+07" -> "+07:00" agar Date.parse tidak menyerah
        new Date(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  }

  if (Number.isNaN(date.getTime())) return String(value ?? '-');

  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/**
 * "2026-10" atau tanpa argumen (bulan berjalan) -> rentang setengah terbuka
 * [from, to) supaya query tetap pakai index transaction_date.
 * @param {string | undefined} input
 * @param {string} today
 */
export function parsePeriod(input, today) {
  const raw = input?.trim() || today.slice(0, 7);
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!match) throw new Error('Format periode harus YYYY-MM, contoh: /rekap 2026-10');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  return {
    label: `${MONTHS_ID[month - 1]} ${year}`,
    from: `${raw}-01`,
    to: `${next.year}-${String(next.month).padStart(2, '0')}-01`,
  };
}
