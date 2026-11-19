/**
 * Regresi /export: dokumen harus dikirim sebagai buffer, bukan string.
 * grammY memperlakukan string sebagai path/URL -> "Wrong port number specified in the URL".
 * Tanpa DB & Telegram nyata. Jalankan: node test/export.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.TELEGRAM_BOT_TOKEN ??= 'dummy:token';
process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:5432/db';
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
const root = new URL('../src/', import.meta.url);

const { getPool } = await import(new URL('db/pool.js', root));
const { onExport } = await import(new URL('bot/handlers/commands.js', root));
const { InputFile } = await import('grammy');

getPool().query = async () => ({
  rows: [
    { id: 1, type: 'INCOME', amount: '8000000.00', category: 'Gaji & Bonus', note: 'gaji', transaction_date: '2026-11-01' },
    { id: 2, type: 'EXPENSE', amount: '25000.00', category: 'Makanan & Minuman', note: 'nasi, "padang"', transaction_date: '2026-11-02' },
  ],
});

let sent;
const ctx = {
  from: { id: 111 },
  match: '2026-11',
  reply: async (text) => {
    throw new Error(`tidak seharusnya reply: ${text}`);
  },
  replyWithDocument: async (doc, extra) => {
    sent = { doc, extra };
    return { document: { file_id: 'x' } };
  },
};

await onExport(ctx);
assert.ok(sent, 'replyWithDocument tidak dipanggil');

// Inti bug: dokumen wajib InputFile berisi Buffer, bukan string.
assert.ok(sent.doc instanceof InputFile, 'dokumen harus InputFile');
assert.ok(!(typeof sent.doc === 'string'), 'dokumen tidak boleh string');
assert.equal(typeof sent.doc.filename, 'string');
assert.match(sent.doc.filename, /^2026-11-transaksi\.csv$/);

const source = sent.doc.source ?? sent.doc.fileData;
assert.ok(Buffer.isBuffer(source), 'source harus Buffer');
/** Isi CSV tanpa BOM, dari InputFile mana pun. */
const csvText = (doc) => (doc.source ?? doc.fileData).toString('utf8').replace(/^\uFEFF/, '');

const text = source.toString('utf8').replace(/^\uFEFF/, '');
// BOM wajib di 3 byte pertama supaya Excel membaca UTF-8.
assert.deepEqual([...source.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
// CRLF antar baris
assert.match(text, /\r\n/);

const csvRows = text.split('\r\n').filter(Boolean);
assert.deepEqual(csvRows[0].split(','), ['no', 'id', 'tanggal', 'tipe', 'kategori', 'nominal', 'catatan']);

// `no` berurutan mulai 1; `id` tetap ID asli dari DB (1 dan 2 di stub) — dua kolom berbeda.
const [row1, row2] = csvRows.slice(1);
assert.match(row1, /^1,1,2026-11-01,INCOME,Gaji & Bonus,8000000\.00,gaji$/);
assert.match(row2, /^2,2,2026-11-02,EXPENSE,Makanan & Minuman,25000\.00,"nasi, ""padang"""$/);

// escaping RFC4180 untuk catatan berkoma + kutip
assert.match(text, /"nasi, ""padang"""/);
assert.match(sent.extra.caption, /Export November 2026/);
assert.match(sent.extra.caption, /Pemasukan/);

// `no` dihitung per file, bukan dari id: id tidak berurutan tetap dapat no 1,2
sent = undefined;
getPool().query = async () => ({
  rows: [
    { id: 91, type: 'EXPENSE', amount: '5000.00', category: 'Lainnya', note: 'a', transaction_date: '2026-11-03' },
    { id: 17, type: 'EXPENSE', amount: '7000.00', category: 'Lainnya', note: 'b', transaction_date: '2026-11-04' },
  ],
});
await onExport(ctx);
const reordered = csvText(sent.doc).split('\r\n').filter(Boolean).slice(1);
assert.match(reordered[0], /^1,91,/);
assert.match(reordered[1], /^2,17,/);

// tanpa transaksi -> tidak kirim file
sent = undefined;
getPool().query = async () => ({ rows: [] });
await onExport({ ...ctx, reply: async () => {} });
assert.equal(sent, undefined, 'tidak boleh kirim dokumen kosong');

console.log('export ok');
