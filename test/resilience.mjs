/**
 * Uji retry + fallback tanpa memanggil API asli: stub `ai.models.generateContent`.
 * Pewarnaan ANSI dimatikan karena console.log stub menulis JSON ke stdout.
 * Jalankan: node test/resilience.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.GEMINI_MODEL = 'primary-model';
process.env.GEMINI_FALLBACK_MODEL = 'fallback-model';
process.env.NO_COLOR = '1';

const { ai, extractFromText } = await import('../src/services/gemini.js');

const httpError = (status) => Object.assign(new Error(`got status: ${status}`), { status });
const ok = (payload) => ({ text: JSON.stringify(payload) });
const valid = {
  type: 'EXPENSE',
  amount: 25000,
  category: 'Makanan & Minuman',
  note: 'nasi padang',
  transaction_date: '2026-11-19',
};

/** sequence: array perilaku per panggilan. */
function stub(sequence) {
  const calls = [];
  ai.models.generateContent = async ({ model }) => {
    calls.push(model);
    const next = sequence.shift();
    if (next === undefined) throw new Error('stub kehabisan sequence');
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

// 1) 503 sekali, lalu sukses di model yang sama: harus retry, bukan fallback.
let calls = stub([httpError(503), ok(valid)]);
let result = await extractFromText('makan siang 25rb', '2026-11-19');
console.log('case 1 calls =', calls);
if (calls.length !== 2 || calls.some((m) => m !== 'primary-model')) throw new Error('case 1 gagal');
if (result.amount !== 25000) throw new Error('case 1 payload salah');

// 2) primary habis 4 percobaan (1 + 3 retry) 503 -> pindah ke fallback.
calls = stub([httpError(503), httpError(503), httpError(503), httpError(503), ok(valid)]);
result = await extractFromText('makan siang 25rb', '2026-11-19');
console.log('case 2 calls =', calls);
if (calls.join(',') !== 'primary-model,primary-model,primary-model,primary-model,fallback-model') {
  throw new Error('case 2 urutan fallback salah');
}

// 3) error non-retryable (400) -> langsung lempar, tanpa retry & tanpa fallback.
calls = stub([httpError(400)]);
try {
  await extractFromText('makan siang 25rb', '2026-11-19');
  throw new Error('case 3 seharusnya gagal');
} catch (error) {
  if (error.kind !== 'failed') throw error;
}
if (calls.length !== 1) throw new Error('case 3 tidak boleh retry');
console.log('case 3 calls =', calls);

// 4) semua jalur 503 -> GeminiError kind busy (pesan ramah).
calls = stub(Array.from({ length: 8 }, () => httpError(503)));
try {
  await extractFromText('makan siang 25rb', '2026-11-19');
  throw new Error('case 4 seharusnya gagal');
} catch (error) {
  if (error.kind !== 'busy') throw error;
  console.log('case 4 ->', error.name, error.kind, '|', error.message);
}

// 5) fetch failed (jaringan) diperlakukan retryable.
calls = stub([new Error('fetch failed'), ok(valid)]);
await extractFromText('makan siang 25rb', '2026-11-19');
if (calls.length !== 2) throw new Error('case 5 fetch failed harus retry');
console.log('case 5 calls =', calls);

console.log('resilience ok');
