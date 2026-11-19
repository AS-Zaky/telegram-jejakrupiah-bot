/**
 * Uji /riwayat: parsing argumen + rendering. Tanpa DB/Telegram.
 * Jalankan: node test/history.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import { HISTORY_USAGE, parseHistoryArgs, renderHistoryView, truncate } from '../src/bot/views.js';
import { clampHistoryLimit } from '../src/db/repo.js';

// ---------- parsing argumen ----------
const ok = (input, limit, type) => {
  const parsed = parseHistoryArgs(input);
  assert.equal(parsed.error, null, `"${input}" seharusnya valid: ${parsed.error}`);
  assert.equal(parsed.limit, limit, `"${input}" limit`);
  assert.equal(parsed.type, type, `"${input}" type`);
};

ok(undefined, 10, null);
ok('', 10, null);
ok('   ', 10, null);
ok('15', 15, null);
ok('20', 20, null);
ok('1', 1, null);
ok('50', 50, null);
ok('999', 50, null); // di-clamp
ok('keluar', 10, 'EXPENSE');
ok('pengeluaran', 10, 'EXPENSE');
ok('masuk', 10, 'INCOME');
ok('pemasukan', 10, 'INCOME');
ok('keluar 5', 5, 'EXPENSE');
ok('5 masuk', 5, 'INCOME');
ok('KELUAR 5', 5, 'EXPENSE'); // case-insensitive
ok('  5   keluar  ', 5, 'EXPENSE'); // spasi berlebih

for (const bad of ['abc', '0', '-5', 'keluar abc', 'masuk keluar', '5 6', 'hapus']) {
  const parsed = parseHistoryArgs(bad);
  assert.ok(parsed.error, `"${bad}" harus menghasilkan error`);
}

// ---------- clamp limit ----------
assert.equal(clampHistoryLimit(0), 1);
assert.equal(clampHistoryLimit(1), 1);
assert.equal(clampHistoryLimit('20'), 20);
assert.equal(clampHistoryLimit(51), 50);
assert.equal(clampHistoryLimit(undefined), 10);
assert.equal(clampHistoryLimit('abc'), 10);

// ---------- truncate ----------
assert.equal(truncate('pendek', 60), 'pendek');
assert.equal(truncate('x'.repeat(60), 60), 'x'.repeat(60));
const long = truncate('y'.repeat(80), 60);
assert.equal(long.length, 60);
assert.ok(long.endsWith('…'));

// ---------- render: kosong ----------
const emptyAll = renderHistoryView([], { limit: 10, type: null });
assert.match(emptyAll, /<b>🧾 10 Transaksi Terakhir<\/b>/);
assert.match(emptyAll, /──────────────/);
assert.match(emptyAll, /Belum ada transaksi tercatat/);

assert.match(renderHistoryView([], { limit: 10, type: 'EXPENSE' }), /Belum ada pengeluaran tercatat/);
assert.match(renderHistoryView([], { limit: 10, type: 'INCOME' }), /Belum ada pemasukan tercatat/);

// ---------- render: isi ----------
const rows = [
  {
    id: 3,
    type: 'EXPENSE',
    amount: '25000.00',
    category: 'Makanan & Minuman',
    note: 'nasi <padang> & es teh',
    transaction_date: new Date(Date.UTC(2026, 10, 19)),
  },
  {
    id: 2,
    type: 'INCOME',
    amount: '8000000.00',
    category: 'Gaji & Bonus',
    note: 'z'.repeat(90),
    transaction_date: '2026-11-01',
  },
  {
    id: 1,
    type: 'EXPENSE',
    amount: '5000.00',
    category: 'Lainnya',
    note: null,
    transaction_date: '2026-10-30',
  },
];

const view = renderHistoryView(rows, { limit: 3, type: null });
assert.match(view, /^<b>🧾 3 Transaksi Terakhir<\/b>/);
assert.match(view, /──────────────/);

const lines = view.split('\n');
const firstEntry = lines.findIndex((l) => l.startsWith('1. '));
assert.match(lines[firstEntry], /^1\. 📤 <code>Rp 25\.000<\/code> <b>Makanan &amp; Minuman<\/b>$/);
assert.match(lines[firstEntry + 1], /^\s{4}19 Nov 2026 · <i>nasi &lt;padang&gt; &amp; es teh<\/i>$/);
// urutan mengikuti input (repo yang mengurutkan)
assert.match(lines[firstEntry + 2], /^2\. 📥 <code>Rp 8\.000\.000<\/code> <b>Gaji &amp; Bonus<\/b>$/);
// catatan panjang dipotong (truncate jalan sebelum escape, jadi hasil < 60 'z')
const zCount = (lines[firstEntry + 3].match(/z/g) ?? []).length;
assert.ok(zCount <= 59, `catatan harus dipotong, dapat ${zCount} z`);
assert.match(lines[firstEntry + 3], /…<\/i>$/);
// note null -> '-'
assert.match(view, /30 Okt 2026 · <i>-<\/i>/);
// input user tidak jadi tag mentah
assert.ok(!view.includes('<padang>'));
// footer
assert.match(view, /<i>\/hapus menghapus transaksi paling atas \(terbaru\)\.<\/i>$/);

// header mengikuti filter tipe
assert.match(renderHistoryView(rows, { limit: 5, type: 'EXPENSE' }), /<b>🧾 5 Pengeluaran Terakhir<\/b>/);
assert.match(renderHistoryView(rows, { limit: 5, type: 'INCOME' }), /<b>🧾 5 Pemasukan Terakhir<\/b>/);

// ---------- render: batas 4096 karakter ----------
const many = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  type: 'EXPENSE',
  amount: '1234567.00',
  category: 'Kategori Yang Cukup Panjang Sekali',
  note: 'catatan panjang '.repeat(6),
  transaction_date: '2026-11-01',
}));
const big = renderHistoryView(many, { limit: 50, type: null });
assert.ok(big.length <= 4200, `pesan terlalu panjang: ${big.length}`);
assert.match(big, /transaksi lain tidak ditampilkan/);
assert.match(big, /\/hapus menghapus transaksi paling atas/);
// blok transaksi tidak terpotong di tengah
assert.ok(!big.includes('<code>Rp 1.234.567</code> <b>Kategori Yang Cukup Panjang Sekali</b>\n</b>'));

// ---------- teks bantuan ----------
assert.match(HISTORY_USAGE, /\/riwayat keluar 5/);

console.log('history ok');
