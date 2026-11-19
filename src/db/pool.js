import pg from 'pg';
import { config } from '../config.js';
import { logError } from '../utils/log.js';

// Lazy: connectionString dibaca saat query pertama, bukan saat import.
let cached;

function createPool() {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
    // Default pg = 0 (tunggu selamanya). Ini penyebab bot diam tanpa error
    // ketika host pooler tidak bisa dihubungi.
    connectionTimeoutMillis: 10_000,
    // Serverless: fungsi di-freeze setelah request, socket idle dianggap mati
    // oleh pooler. Umur pendek mencegah "connection timeout" pada warm start
    // dan menjaga slot koneksi Supabase tidak penuh.
    idleTimeoutMillis: 10_000,
    max: 5,
    allowExitOnIdle: true,
  });

  // WAJIB: error dari koneksi idle mematikan proses kalau tidak ada listener.
  pool.on('error', (error) => logError('[DB]', `idle client error: ${error.message}`));

  return pool;
}

/** Pool module-level: satu per proses, reconnect otomatis. */
export function getPool() {
  return (cached ??= createPool());
}
