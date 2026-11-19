/**
 * Smoke test deployment serverless: health check webhook + otorisasi cron.
 * Tanpa Telegram, tanpa DB. Jalankan: node test/serverless.mjs
 */
process.env.GEMINI_API_KEY ??= 'dummy';
process.env.TELEGRAM_BOT_TOKEN ??= '123:dummy-token';
process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:5432/db';
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';

/** Res palsu: cukup untuk handler Node polos. */
function mockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    writeHead(code, extra = {}) {
      res.statusCode = code;
      Object.assign(res.headers, extra);
      return res;
    },
    end(chunk) {
      res.body = chunk ?? '';
      res.ended = true;
    },
  };
  return res;
}

const call = async (handler, req) => {
  const res = mockRes();
  await handler(req, res);
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
};

// ---------- GET /api/webhook ----------
{
  const { default: handler } = await import('../api/webhook.js');
  const out = await call(handler, { method: 'GET', headers: {} });
  assert.equal(out.status, 200);
  assert.match(out.headers['content-type'], /application\/json/);
  assert.deepEqual(out.json, { ok: true, service: 'jejakrupiah-webhook' });
}

// ---------- method selain GET/POST ----------
{
  const { default: handler } = await import('../api/webhook.js');
  const out = await call(handler, { method: 'PUT', headers: {} });
  assert.equal(out.status, 405);
  assert.equal(out.headers.allow, 'GET, POST');
}

// ---------- POST /api/webhook dengan secret tidak cocok -> ditolak grammy ----------
{
  // getBot() dari webhook.js bisa saja sudah ter-cache dengan secret lain,
  // jadi bangun handler baru dengan instance bot terpisah untuk kasus ini.
  const { Bot, webhookCallback } = await import('grammy');
  const isolated = new Bot('123:isolated-token');
  // Paksa init() jalan supaya secret header benar-benar dicek, tanpa network.
  // Handler callback update tidak pernah terpanggil (request ditolak sebelum itu).
  let initDone = false;
  isolated.init = async () => {
    initDone = true;
  };
  isolated.botInfo = { id: 123, is_bot: true, first_name: 'test', username: 'test_bot' };

  const guarded = webhookCallback(isolated, 'http', { secretToken: 'rahasia' });
  const res = mockRes();
  await guarded({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'salah' }, body: {} }, res);
  assert.equal(res.statusCode, 401, 'secret salah harus 401');
  assert.ok(initDone, 'bot.init() harus dijalankan sebelum verifikasi secret');
}

// ---------- /api/cron ----------
{
  const { default: handler } = await import('../api/cron.js');

  // tanpa CRON_SECRET -> lolos validasi; runDailyRecap asli jalan
  // (hari ini bukan akhir bulan, jadi keluar lebih awal tanpa query DB)
  delete process.env.CRON_SECRET;
  const open = await call(handler, { method: 'GET', headers: {} });
  assert.equal(open.status, 200, 'tanpa CRON_SECRET harus jalan');
  assert.equal(open.json.ok, true);
  assert.equal(typeof open.json.result.skipped, 'boolean');

  // dengan CRON_SECRET
  process.env.CRON_SECRET = 'cron-rahasia';

  const unauthorized = await call(handler, { method: 'GET', headers: {} });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.json.ok, false);

  const wrong = await call(handler, {
    method: 'GET',
    headers: { authorization: 'Bearer salah' },
  });
  assert.equal(wrong.status, 401);

  const ok = await call(handler, {
    method: 'GET',
    headers: { authorization: 'Bearer cron-rahasia' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(typeof ok.json.result.skipped, 'boolean');

  // secret tanpa prefix Bearer ditolak
  const raw = await call(handler, { method: 'GET', headers: { authorization: 'cron-rahasia' } });
  assert.equal(raw.status, 401);
}

// ---------- vercel.json ----------
{
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.functions['api/*.js'].maxDuration, 60);
  assert.deepEqual(config.crons, [{ path: '/api/cron', schedule: '0 13 * * *' }]);
}

console.log('serverless ok');
