/**
 * Uji deteksi MIME + format tanggal. Tanpa network, tanpa DB.
 * Jalankan: node test/media.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';

import assert from 'node:assert/strict';
import { mimeFromMagic, mimeFromPath, resolveMime } from '../src/utils/mime.js';
import { formatDate } from '../src/utils/format.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.from('VP8 ', 'latin1'),
]);
const pdf = Buffer.from('%PDF-1.7\n...', 'latin1');
const unknown = Buffer.from('GIF89a-not-supported', 'latin1');

// magic bytes
assert.equal(mimeFromMagic(jpeg), 'image/jpeg');
assert.equal(mimeFromMagic(png), 'image/png');
assert.equal(mimeFromMagic(webp), 'image/webp');
assert.equal(mimeFromMagic(pdf), 'application/pdf');
assert.equal(mimeFromMagic(unknown), null);
assert.equal(mimeFromMagic(Buffer.alloc(0)), null);

// ekstensi file_path Telegram
assert.equal(mimeFromPath('photos/file_12.jpg'), 'image/jpeg');
assert.equal(mimeFromPath('documents/file_1.PNG'), 'image/png');
assert.equal(mimeFromPath('documents/file_2.webp'), 'image/webp');
assert.equal(mimeFromPath('documents/file_3.pdf'), 'application/pdf');
assert.equal(mimeFromPath('documents/file_4.bin'), null);
assert.equal(mimeFromPath(undefined), null);

// kasus bug utama: header octet-stream + magic bytes menang
assert.equal(resolveMime(jpeg, 'application/octet-stream', 'photos/file.jpg'), 'image/jpeg');
assert.equal(resolveMime(png, 'application/octet-stream', 'photos/file.png'), 'image/png');

// header boleh dipakai kalau memang image/* (magic bytes tak dikenali)
const heic = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
assert.equal(resolveMime(heic, 'image/heic', 'file.heic'), 'image/heic');

// header ngawur -> jatuh ke ekstensi
assert.equal(resolveMime(heic, 'application/octet-stream', 'file.webp'), 'image/webp');

// benar-benar tidak dikenali -> null (handler membalas pesan format)
assert.equal(resolveMime(unknown, 'application/octet-stream', 'file.bin'), null);

// param charset di header tetap diparse
assert.equal(resolveMime(heic, 'image/jpeg; charset=binary', 'x'), 'image/jpeg');

// --- format tanggal ---
// pg RETURNING memberi Date; nilai Date UTC 00:00 harus tampil tanggal yang sama.
assert.equal(formatDate(new Date(Date.UTC(2026, 10, 19)), 'Asia/Jakarta'), '19 Nov 2026');
// string dari Gemini
assert.equal(formatDate('2026-11-19', 'Asia/Jakarta'), '19 Nov 2026');
// timestamp pg lengkap
assert.equal(formatDate('2026-11-19 00:00:00+07', 'Asia/Jakarta'), '19 Nov 2026');
// nilai tak valid tidak boleh melempar
assert.equal(formatDate(undefined, 'Asia/Jakarta'), '-');

console.log('media ok');
