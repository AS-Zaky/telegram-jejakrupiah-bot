import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { formatRupiah, parsePeriod, todayISO } from '../src/utils/format.js';
import { normalizeExtraction } from '../src/utils/validate.js';
import { reportText } from '../src/bot/views.js';
import { GeminiError, userMessage } from '../src/services/errors.js';
import { RETRY_DELAYS_MS } from '../src/services/gemini.js';

// Model configurable, default tidak boleh kosong & tanpa prefix "models/".
assert.equal(config.model, process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash');
assert.ok(config.model.length > 0);
assert.ok(!config.model.startsWith('models/'), 'jangan pakai prefix models/, SDK yang menambahkan');
assert.equal(config.fallbackModel, process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-3.8-flash-lite');
assert.notEqual(config.fallbackModel, config.model, 'fallback harus beda dari model utama');

// Backoff: 3 retry, naik bertahap.
assert.deepEqual(RETRY_DELAYS_MS, [1500, 3000, 5000]);

// 503 -> pesan ramah, bukan raw JSON.
assert.match(userMessage(new GeminiError('busy', 'x')), /sedang sibuk/);
assert.match(userMessage(new GeminiError('timeout', 'x')), /terlalu lama/);

const today = todayISO('Asia/Jakarta');
assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

const tx = normalizeExtraction(
  { type: 'expense', amount: 25000.4, category: 'Makanan & Minuman', note: 'nasi padang', transaction_date: today },
  today,
);
assert.equal(tx.type, 'EXPENSE');
assert.equal(tx.amount, 25000.4);
assert.equal(tx.transaction_date, today);

// kategori asing -> fallback, tanggal masa depan -> today, type ngawur -> throw
assert.equal(normalizeExtraction({ type: 'INCOME', amount: 1, category: 'X', transaction_date: '2099-01-01' }, today).category, 'Lainnya');
assert.equal(normalizeExtraction({ type: 'INCOME', amount: 1, category: 'X', transaction_date: '2099-01-01' }, today).transaction_date, today);
assert.throws(() => normalizeExtraction({ type: 'EXPENSE', amount: 0, category: 'Belanja' }, today));
assert.throws(() => normalizeExtraction({ type: 'HUTANG', amount: 5, category: 'Belanja' }, today));

const period = parsePeriod('2026-12', today);
assert.equal(period.to, '2027-01-01');
assert.equal(parsePeriod(undefined, '2026-10-05').from, '2026-10-01');
assert.throws(() => parsePeriod('2026-13', today));

assert.equal(formatRupiah(1500).replace(/\u00a0/g, ' '), 'Rp 1.500');

const report = reportText(
  'Oktober 2026',
  [{ category: 'Gaji & Bonus', total: '8000000', count: 1 }],
  [
    { category: 'Belanja', total: '300000', count: 2 },
    { category: 'Transportasi', total: '100000', count: 4 },
  ],
  [
    { category: 'Belanja', total: '300000', count: 2 },
    { category: 'Transportasi', total: '100000', count: 4 },
  ],
);
assert.match(report, /Rekap Oktober 2026/);
assert.match(report, /1\. <b>Belanja<\/b>/);
assert.match(report, /2\. <b>Transportasi<\/b>/);
assert.match(report, /75\.0%/);

console.log('smoke ok');
