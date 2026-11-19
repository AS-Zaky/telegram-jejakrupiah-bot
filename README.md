# Telegram Jejak Rupiah Bot

Bot Telegram pencatat keuangan pribadi. Parsing teks natural + ekstraksi foto struk pakai
`gemini-3.8-flash` (structured output, ganti lewat `GEMINI_MODEL`), data di PostgreSQL, konfirmasi lewat inline keyboard.

## Stack
Node.js >= 22.9 (ESM) · grammy · @google/genai · pg · PostgreSQL

## Setup

```bash
npm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
```

Isi `.env`: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`,
opsional `GEMINI_MODEL` (default `gemini-3.8-flash`), `ALLOWED_TELEGRAM_IDS` (kosong = semua orang boleh),
dan `APP_TIMEZONE`.

Buat database dulu:

```bash
createdb jejakrupiah
```

## Migrasi

```bash
npm run migrate
```

Idempoten (`CREATE TABLE IF NOT EXISTS`), aman dijalankan berulang.

## Jalankan (long polling)

```bash
npm start
# dev + auto reload:
npm run dev
```

## Self-check

```bash
npm run check   # smoke test: validasi, format, config
npm test        # smoke + retry/fallback Gemini + MIME & format tanggal
```

## Kalau bot diam (tidak membalas)

Log berstempel waktu sekarang menunjukkan step mana yang menggantung. Baca baris terakhir sebelum
bot diam:

| Terakhir terlihat | Artinya | Tindakan |
|---|---|---|
| `[TEXT] Menerima pesan` doang | macet di Gemini | cek `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `[GEMINI] Memanggil model ...` tanpa lanjutan | network/API Gemini | akan timeout 20s lalu balas pesan error |
| `[DB] Menyimpan transaksi PENDING` doang | macet ke PostgreSQL | cek `DATABASE_URL` host/port bisa dijangkau |
| `[ERROR]` | error lengkap + stack di terminal | baca stack-nya |
| `[HANG] handler >30s` | handler belum selesai | kombinasikan dengan baris di atas |
| tak ada satu pun baris | update tidak sampai ke bot | cek token, atau whitelist menolak user |

Bot selalu membalas paling lambat 20 detik setelah pesan masuk, karena request Gemini dibatasi
`AbortSignal.timeout(20000)` + `httpOptions.timeout` dan koneksi Postgres dibatasi
`connectionTimeoutMillis: 10000`. Kalau sebelumnya diam tanpa error, itu karena default `pg`
(`connectionTimeoutMillis: 0`) menunggu selamanya.

## Kalau Gemini balas 503 / server sibuk

`src/services/gemini.js` punya dua lapis ketahanan:

1. **Retry + backoff** di model yang sama: 3 percobaan ulang, jeda 1.5s → 3s → 5s.
   Retry juga berlaku untuk 429, 5xx lain, timeout, dan error jaringan (`fetch failed`).
2. **Fallback model**: kalau 4 percobaan habis, satu putaran retry penuh dijalankan pada
   `GEMINI_FALLBACK_MODEL` (default `gemini-3.8-flash-lite`).

Kalau dua-duanya gagal, user menerima `⏳ Server AI sedang sibuk, silakan kirim ulang dalam beberapa saat.`
bukan stack trace. Error non-retryable (400, 403, payload salah) **tidak** di-retry supaya tidak
menghabiskan waktu user.

Skenario terburuk: 4 × 20s (primary) + 4 × 20s (fallback) + jeda 5s ≈ 3 menit. Kalau terlalu lama,
turunkan `TIMEOUT_MS` di `src/services/gemini.js`; setiap percobaan punya timeout sendiri.

**Supabase / pooler**: `ssl: { rejectUnauthorized: false }` sudah dipasang, karena endpoint pooler
memakai sertifikat yang tidak selalu lolos verifikasi CA lokal (penyebab umum error SSL
`self-signed certificate in certificate chain`). Kalau mau verifikasi penuh, unduh CA Supabase dan
ganti jadi `ssl: { ca: fs.readFileSync('ca.crt') }`.

## Rekap otomatis akhir bulan

`src/services/scheduler.js` menjalankan cron `0 20 * * *` menurut `APP_TIMEZONE`. Tiap hari dicek
dulu: kalau besok bukan tanggal 1, keluar **tanpa query DB**. Kalau hari ini hari terakhir bulan,
setiap user di `ALLOWED_TELEGRAM_IDS` menerima `📅 *Rekap Otomatis Akhir Bulan*` berisi rekap bulan
berjalan. Pengiriman per-user dibungkus `try/catch` — satu user yang memblokir bot tidak
menghentikan sisanya, dan setiap kegagalan tercatat sebagai `[CRON]`.

Scheduler dijalankan di dalam `onStart` callback `bot.start()`, jadi mengimpor `src/index.js` untuk
test tidak meninggalkan proses cron hidup.

Konsekuensi: **rekap hanya terkirim kalau `ALLOWED_TELEGRAM_IDS` terisi**. Kalau whitelist kosong
(semua orang boleh pakai bot), tidak ada daftar tujuan — bot mencatat `[CRON]` dan berhenti.

## Deploy ke Vercel (webhook)

Mode lokal tetap `npm start` (long polling). Untuk Vercel, dua fungsi di `api/` menggantikannya:

- **`api/webhook.js`** — `GET` = health check, `POST` = diteruskan ke `webhookCallback(bot, 'http')`.
  Bot dipakai lewat `getBot()` yang meng-cache instance di level modul, jadi warm invocation
  tidak membuat ulang bot.
- **`api/cron.js`** — dipanggil `vercel.json` tiap `0 13 * * *` (20:00 WIB). Kalau `CRON_SECRET`
  diset, header `Authorization: Bearer <CRON_SECRET>` wajib cocok, kalau tidak 401.
  `runDailyRecap` sudah melewati hari yang bukan akhir bulan.

Env tambahan di dashboard Vercel: `TELEGRAM_WEBHOOK_SECRET` dan `CRON_SECRET`. Keduanya opsional
tapi sangat disarankan — tanpa secret, siapa pun yang tahu URL bisa memicu rekap atau mengirim
update palsu. Setelah deploy, daftarkan webhook sekali:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<proyek>.vercel.app/api/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Kedua file memakai response API Node polos (`res.statusCode`, `res.end`), bukan `res.status().json()`
— metode itu milik Next.js dan tidak ada di runtime Node Vercel.

Pool Postgres disetel untuk serverless (`idleTimeoutMillis: 10000`, `max: 5`,
`allowExitOnIdle: true`) supaya socket idle yang dibekukan Vercel tidak menahan slot koneksi
Supabase.

## MIME type & tanggal

Telegram sering mengirim `content-type: application/octet-stream` saat file diunduh, dan Gemini
menolak mime selain `image/*` atau `application/pdf`. `src/utils/mime.js` menentukan tipe dengan
urutan: **magic bytes** buffer (`FF D8 FF` → jpeg, `89 50 4E 47` → png, `RIFF....WEBP` → webp,
`%PDF` → pdf) → header kalau memang `image/*`/`application/pdf` → ekstensi `file_path`.
`src/services/gemini.js` juga menolak mime tak valid sebelum request dikirim, jadi tidak ada lagi
`400 INVALID_ARGUMENT` dari sisi API.

Tanggal di kartu konfirmasi memakai `formatDate()` (`src/utils/format.js`), menerima `Date` dari
`pg RETURNING` maupun string `YYYY-MM-DD` dari Gemini, hasilnya `19 Nov 2026` sesuai `APP_TIMEZONE`.

## Perintah

| Input | Hasil |
|---|---|
| `makan siang 25rb` | ekstraksi EXPENSE → kartu konfirmasi |
| `gaji masuk 8.500.000` | ekstraksi INCOME |
| foto struk + (opsional) caption | grand total + ringkasan item |
| dokumen JPG/PNG/WebP/PDF | sama seperti foto |
| `/rekap` | rekap bulan berjalan (CONFIRMED saja) |
| `/rekap 2026-10` | rekap bulan tertentu |
| `/export` | CSV transaksi CONFIRMED bulan berjalan |
| `/riwayat` | 10 transaksi terakhir; `20` untuk jumlah lain, `keluar`/`masuk` untuk filter tipe |
| `/hapus` | hapus transaksi CONFIRMED terakhir (pakai tombol konfirmasi) |

Semua pesan memakai `parse_mode: 'HTML'`. Nilai dari user (kategori, catatan) selalu lewat
`escapeHtml()` sebelum masuk markup, jadi nama kategori seperti `Buku & Alat <Tulis>` tidak
merusak parsing Telegram.

## Struktur

```
schema.sql                 DDL tabel transactions
scripts/migrate.js         apply schema.sql
src/index.js               entry point long polling
src/config.js              env + whitelist parsing (lazy)
src/bot/bot.js             wiring command/handler
src/bot/middleware.js      security whitelist
src/bot/views.js           teks pesan + inline keyboard
src/bot/handlers/          text.js, photo.js, commands.js
src/services/gemini.js     structured output text + multimodal
src/db/                    pool.js, repo.js
src/utils/                 format.js, validate.js, constants.js
test/smoke.mjs             assert-based self-check
```
