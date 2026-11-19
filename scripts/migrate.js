import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL belum diisi. Copy .env.example ke .env lalu isi koneksinya.');
  process.exit(1);
}

const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
  max: 1,
});

try {
  await pool.query(await readFile(schemaPath, 'utf8'));
  console.log(`migrated: ${schemaPath}`);
} catch (error) {
  console.error(`migrasi gagal: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
