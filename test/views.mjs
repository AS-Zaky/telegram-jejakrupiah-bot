/**
 * Uji markup HTML pada semua view + escapeHtml. Tanpa DB/Telegram.
 * Jalankan: node test/views.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import { alignTotals, escapeHtml } from '../src/utils/format.js';
import {
  cancelledText,
  deletionCancelledText,
  deletionSuccessText,
  denialText,
  HELP,
  NO_CONFIRMED_TEXT,
  PARSE_MODE,
  previewText,
  proportionBar,
  renderDeleteConfirmCard,
  reportText,
  savedText,
} from '../src/bot/views.js';

// ---------- escapeHtml ----------
assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
assert.equal(escapeHtml('nasi & <sate> "enak"'), 'nasi &amp; &lt;sate&gt; &quot;enak&quot;');
assert.equal(escapeHtml(''), '');
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(undefined), '');
// ampersand duluan, jangan sampai entity hasil escape di-escape ulang
assert.equal(escapeHtml('&lt;'), '&amp;lt;');

// ---------- alignTotals ----------
const aligned = alignTotals([
  ['Pemasukan', 'Rp 8.000.000'],
  ['Pengeluaran', 'Rp 300.000'],
  ['Selisih', 'Rp 7.700.000'],
]);
assert.equal(new Set(aligned.map((l) => l.length)).size, 1, 'panjang tiap baris harus sama');
assert.equal(new Set(aligned.map((l) => l.indexOf(':'))).size, 1, 'titik dua harus sejajar');
assert.deepEqual(
  aligned.map((l) => l.split(': ')[1].split('Rp')[0].length),
  [0, 2, 0],
  'nominal rata kanan: yang lebih pendek dapat padding, dua lainnya rata',
);
assert.match(aligned[0], /^Pemasukan +: Rp/);
assert.match(aligned[2], /^Selisih +: Rp/);
assert.deepEqual(alignTotals([]), []);

// ---------- proportionBar ----------
assert.equal(proportionBar(100), '██████████');
assert.equal(proportionBar(50), '█████░░░░░');
assert.equal(proportionBar(0), '░░░░░░░░░░');
assert.equal(proportionBar(3), '█░░░░░░░░░', 'porsi kecil tetap tampil 1 blok');
assert.equal(proportionBar(NaN), '░░░░░░░░░░');

// ---------- kartu konfirmasi ----------
const tx = {
  id: 42,
  type: 'EXPENSE',
  amount: '25000.00',
  category: 'Makanan & Minuman',
  note: 'nasi <padang> & es teh',
  transaction_date: new Date(Date.UTC(2026, 10, 19)),
};

const preview = previewText(tx);
assert.match(preview, /^<b>Konfirmasi Transaksi<\/b>/);
assert.match(preview, /──────────────/);
assert.match(preview, /Nominal {2}: <code>Rp.{0,2}25\.000<\/code>/);
assert.match(preview, /Kategori : <b>Makanan &amp; Minuman<\/b>/);
assert.match(preview, /Catatan {2}: <i>nasi &lt;padang&gt; &amp; es teh<\/i>/);
assert.match(preview, /Tanggal {2}: 19 Nov 2026/);
// tidak ada tag mentah dari input user
assert.ok(!preview.includes('<padang>'), 'input user tidak boleh jadi tag mentah');

const saved = savedText(tx);
assert.match(saved, /^<b>✅ Transaksi Tersimpan<\/b>/);
assert.match(saved, /<code>Rp/);
assert.ok(!saved.includes('<padang>'));

assert.match(cancelledText(), /<b>Transaksi dibatalkan<\/b>/);
assert.equal(cancelledText(), cancelledText());

// catatan kosong -> '-'
assert.match(previewText({ ...tx, note: '' }), /Catatan {2}: <i>-<\/i>/);

// ---------- kartu /hapus ----------
const card = renderDeleteConfirmCard({ ...tx, note: 'kopi' });
assert.match(card.text, /^<b>🗑️ Hapus Transaksi Terakhir\?<\/b>/);
assert.match(card.text, /<i>Penghapusan bersifat permanen/);
assert.deepEqual(
  card.reply_markup.inline_keyboard[0].map((b) => b.callback_data),
  ['del_confirm:42', 'del_cancel:42'],
);
assert.match(deletionSuccessText({ ...tx, transaction_date: '2026-11-19' }), /^<b>🗑️ Transaksi Dihapus<\/b>/);
assert.match(deletionCancelledText(), /<b>Penghapusan dibatalkan/);
assert.match(NO_CONFIRMED_TEXT, /Belum ada transaksi tersimpan/);
assert.match(denialText('<script>'), /<code>&lt;script&gt;<\/code>/);

// ---------- /rekap ----------
const report = reportText(
  'November 2026',
  [{ category: 'Gaji & Bonus', total: '8000000', count: 1 }],
  [
    { category: 'Belanja <harian>', total: '300000', count: 2 },
    { category: 'Transportasi', total: '100000', count: 4 },
  ],
  [],
);
assert.match(report, /^<b>📊 Rekap November 2026<\/b>/);
assert.match(report, /<pre>[\s\S]*Pemasukan +:[\s\S]*<\/pre>/);
assert.match(report, /Selisih 📈 +: Rp/);
assert.match(report, /1\. <b>Belanja &lt;harian&gt;<\/b> — <code>Rp.{0,2}300\.000<\/code>/);
assert.match(report, /75\.0%, 2x/);
assert.match(report, /<code>████████░░<\/code>/, '75% = 8 blok terisi');
assert.match(report, /<code>███░░░░░░░<\/code>/, '25% = 3 blok terisi');
assert.ok(!report.includes('<harian>'), 'kategori user di-escape');

// tanpa pengeluaran
const empty = reportText('Oktober 2026', [], [], []);
assert.match(empty, /<i>Belum ada pengeluaran tercatat bulan ini\.<\/i>/);

// ---------- help & parse mode ----------
assert.match(HELP, /<b>Bot Jejak Rupiah<\/b>/);
assert.match(HELP, /<blockquote>makan siang nasi padang 25rb/);
assert.match(HELP, /\/hapus — hapus transaksi terakhir/);
assert.deepEqual(PARSE_MODE, { parse_mode: 'HTML' });

console.log('views ok');
