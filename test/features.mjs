/**
 * Uji /hapus (kartu + parsing callback) dan deteksi akhir bulan. Tanpa DB/Telegram.
 * Jalankan: node test/features.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import { isLastDayOfMonth, buildMonthlyRecapMessage } from '../src/services/scheduler.js';
import {
  CALLBACK,
  deletionCancelledText,
  deletionSuccessText,
  HELP,
  NO_CONFIRMED_TEXT,
  parseCallback,
  renderDeleteConfirmCard,
} from '../src/bot/views.js';

// ---------- deteksi hari terakhir bulan ----------
const lastDays = [
  '2026-01-31',
  '2026-02-28', // non-kabisat
  '2028-02-29', // kabisat
  '2024-02-29', // kabisat
  '2100-02-28', // abad non-kabisat
  '2000-02-29', // abad kabisat
  '2026-03-31',
  '2026-04-30',
  '2026-05-31',
  '2026-06-30',
  '2026-11-30',
  '2026-12-31',
];
for (const date of lastDays) {
  assert.equal(isLastDayOfMonth(date), true, `${date} seharusnya akhir bulan`);
}

const notLastDays = [
  '2026-02-27',
  '2026-02-26',
  '2027-02-27', // 2027 non-kabisat, 28 akhir bulan
  '2028-02-28', // kabisat, 28 bukan akhir bulan
  '2026-04-29',
  '2026-01-30',
  '2026-11-19',
  '2026-12-30',
];
for (const date of notLastDays) {
  assert.equal(isLastDayOfMonth(date), false, `${date} bukan akhir bulan`);
}

// ---------- format kartu /hapus ----------
const tx = {
  id: 42,
  type: 'EXPENSE',
  amount: '25000.00',
  category: 'Makanan & Minuman',
  note: 'nasi padang',
  transaction_date: new Date(Date.UTC(2026, 10, 19)),
};

const card = renderDeleteConfirmCard(tx);
assert.match(card.text, /<b>🗑️ Hapus Transaksi Terakhir\?<\/b>/);
assert.match(card.text, /📤 <b>Pengeluaran<\/b>/);
assert.match(card.text, /Nominal {2}: <code>Rp.{0,2}25\.000<\/code>/);
assert.match(card.text, /Kategori : <b>Makanan &amp; Minuman<\/b>/);
assert.match(card.text, /Tanggal {2}: 19 Nov 2026/);
assert.match(card.text, /Catatan {2}: <i>nasi padang<\/i>/);
assert.match(card.text, /permanen/);

const buttons = card.reply_markup.inline_keyboard[0];
assert.deepEqual(
  buttons.map((b) => b.callback_data),
  ['del_confirm:42', 'del_cancel:42'],
);
assert.equal(buttons[0].text, '🗑️ Ya, Hapus');
assert.equal(buttons[1].text, '❌ Batal');
assert.equal(CALLBACK.deleteConfirm(42), 'del_confirm:42');
assert.equal(CALLBACK.deleteCancel(42), 'del_cancel:42');

// note kosong -> placeholder '-'
assert.match(renderDeleteConfirmCard({ ...tx, note: null }).text, /Catatan {2}: <i>-<\/i>/);

// teks hasil aksi
assert.match(deletionSuccessText({ ...tx, transaction_date: '2026-11-19' }), /Transaksi Dihapus/);
assert.match(deletionCancelledText(), /Penghapusan dibatalkan/);
assert.match(NO_CONFIRMED_TEXT, /Belum ada transaksi tersimpan/);
assert.match(HELP, /\/hapus — hapus transaksi terakhir/);

// ---------- parsing callback ----------
assert.deepEqual(parseCallback('del_confirm:42'), {
  action: 'del_confirm',
  id: 42,
  isTransaction: false,
  isDelete: true,
});
assert.deepEqual(parseCallback('del_cancel:7'), {
  action: 'del_cancel',
  id: 7,
  isTransaction: false,
  isDelete: true,
});
assert.equal(parseCallback('confirm:9').isTransaction, true);
assert.equal(parseCallback('cancel:9').isTransaction, true);

// payload rusak tidak boleh dianggap valid (jangan hapus record sembarangan)
for (const bad of ['del_confirm:', 'del_confirm:abc', 'del_confirm:0', 'del_confirm:-3', 'del_confirm:1.5', '', 'hapus:1']) {
  const parsed = parseCallback(bad);
  assert.equal(parsed.isDelete, false, `"${bad}" tidak boleh valid`);
  assert.equal(parsed.isTransaction, false, `"${bad}" bukan aksi transaksi`);
}

// id hanya terisi kalau aksinya dikenal
assert.equal(parseCallback('hapus:1').id, null);
assert.equal(parseCallback('del_confirm:abc').id, null);
assert.equal(parseCallback('del_confirm:12').id, 12);

// ---------- pesan rekap otomatis ----------
const recap = buildMonthlyRecapMessage('2026-11', [
  { type: 'INCOME', category: 'Gaji & Bonus', total: '8000000', count: 1 },
  { type: 'EXPENSE', category: 'Belanja', total: '300000', count: 2 },
]);
assert.match(recap, /Rekap Otomatis Akhir Bulan/);
assert.match(recap, /Rekap November 2026/);
assert.match(recap, /1\. <b>Belanja<\/b>/);

console.log('features ok');
