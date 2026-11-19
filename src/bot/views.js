import { config } from '../config.js';
import { HISTORY_MAX, clampHistoryLimit } from '../db/repo.js';
import { alignTotals, escapeHtml, formatDate, formatRupiah } from '../utils/format.js';

const TYPE_LABEL = { INCOME: 'Pemasukan', EXPENSE: 'Pengeluaran' };
const TYPE_ICON = { INCOME: '📥', EXPENSE: '📤' };
const DIVIDER = '──────────────';

/** Semua pesan bot memakai HTML; satu konstanta biar tidak lupa. */
export const PARSE_MODE = { parse_mode: 'HTML' };

export const CALLBACK = {
  confirm: (id) => `confirm:${id}`,
  cancel: (id) => `cancel:${id}`,
  deleteConfirm: (id) => `del_confirm:${id}`,
  deleteCancel: (id) => `del_cancel:${id}`,
};

const DELETE_ACTIONS = new Set(['del_confirm', 'del_cancel']);
const TRANSACTION_ACTIONS = new Set(['confirm', 'cancel']);
const KNOWN_ACTIONS = new Set([...TRANSACTION_ACTIONS, ...DELETE_ACTIONS]);

/**
 * Parse callback_data tanpa melempar: `del_confirm:12` -> `{ action, id: 12 }`.
 * `id` hanya terisi kalau aksi dikenal & id bilangan bulat positif.
 * @param {string} data
 */
export function parseCallback(data) {
  const [action, rawId] = String(data ?? '').split(':');
  const id = Number(rawId);
  const valid = KNOWN_ACTIONS.has(action) && Number.isInteger(id) && id > 0;
  return {
    action,
    id: valid ? id : null,
    isTransaction: valid && TRANSACTION_ACTIONS.has(action),
    isDelete: valid && DELETE_ACTIONS.has(action),
  };
}

/** Baris isi kartu: semua nilai user di-escape, markup dari kode. */
function detailLines(tx) {
  return [
    `${TYPE_ICON[tx.type]} <b>${TYPE_LABEL[tx.type]}</b>`,
    `Kategori : <b>${escapeHtml(tx.category)}</b>`,
    `Tanggal  : ${formatDate(tx.transaction_date, config.timezone)}`,
    `Catatan  : <i>${escapeHtml(tx.note || '-')}</i>`,
  ];
}

const amountLine = (tx) => `Nominal  : <code>${formatRupiah(tx.amount)}</code>`;

/** @param {import('../config.js').Extraction} tx */
export function previewText(tx) {
  return [`<b>Konfirmasi Transaksi</b>`, DIVIDER, ...detailLines(tx), amountLine(tx), '', 'Simpan transaksi ini?'].join(
    '\n',
  );
}

export function confirmKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Simpan', callback_data: CALLBACK.confirm(id) },
        { text: '❌ Batal', callback_data: CALLBACK.cancel(id) },
      ],
    ],
  };
}

/** Dipanggil setelah tombol diklik: keyboard dilepas supaya tidak dobel-klik. */
export function savedText(tx) {
  return [`<b>✅ Transaksi Tersimpan</b>`, DIVIDER, ...detailLines(tx), amountLine(tx)].join('\n');
}

export function cancelledText() {
  return '❌ <b>Transaksi dibatalkan</b> dan tidak dicatat.';
}

/** Kartu konfirmasi /hapus: transaksi apa yang akan dihapus. */
export function renderDeleteConfirmCard(tx) {
  return {
    text: [
      '<b>🗑️ Hapus Transaksi Terakhir?</b>',
      DIVIDER,
      ...detailLines(tx),
      amountLine(tx),
      '',
      '<i>Penghapusan bersifat permanen dan tidak bisa dibatalkan.</i>',
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🗑️ Ya, Hapus', callback_data: CALLBACK.deleteConfirm(tx.id) },
          { text: '❌ Batal', callback_data: CALLBACK.deleteCancel(tx.id) },
        ],
      ],
    },
  };
}

export function deletionSuccessText(tx) {
  return [`<b>🗑️ Transaksi Dihapus</b>`, DIVIDER, ...detailLines(tx), amountLine(tx)].join('\n');
}

export function deletionCancelledText() {
  return '↩️ <b>Penghapusan dibatalkan.</b> Transaksi tetap tersimpan.';
}

export const NO_CONFIRMED_TEXT = 'ℹ️ Belum ada transaksi tersimpan yang bisa dihapus.';

/** Bar proporsi 10 blok: `██████░░░░`. */
export function proportionBar(share, blocks = 10) {
  const ratio = Number.isFinite(share) ? Math.min(Math.max(share, 0), 100) / 100 : 0;
  let filled = Math.round(ratio * blocks);
  // Kategori yang ada nominalnya jangan tampil kosong total.
  if (ratio > 0 && filled === 0) filled = 1;
  return '█'.repeat(filled) + '░'.repeat(blocks - filled);
}

/** @param {string} label @param {Array<{ category: string, total: string, count: number }>} expense */
export function reportText(label, income, expense, rows) {
  const totalIncome = income.reduce((acc, r) => acc + Number(r.total), 0);
  const totalExpense = expense.reduce((acc, r) => acc + Number(r.total), 0);
  const net = totalIncome - totalExpense;

  const summary = alignTotals([
    ['Pemasukan', formatRupiah(totalIncome)],
    ['Pengeluaran', formatRupiah(totalExpense)],
    [net >= 0 ? 'Selisih 📈' : 'Selisih 📉', formatRupiah(net)],
  ]);

  const blocks = [
    `<b>📊 Rekap ${escapeHtml(label)}</b>`,
    DIVIDER,
    `<pre>${summary.join('\n')}</pre>`,
  ];

  if (expense.length === 0) {
    blocks.push('', '<i>Belum ada pengeluaran tercatat bulan ini.</i>');
    return blocks.join('\n');
  }

  blocks.push('', '<b>Pengeluaran per kategori</b>');
  for (const [i, row] of expense.entries()) {
    const share = totalExpense ? (Number(row.total) / totalExpense) * 100 : 0;
    blocks.push(
      `${i + 1}. <b>${escapeHtml(row.category)}</b> — <code>${formatRupiah(row.total)}</code>` +
        ` <i>(${share.toFixed(1)}%, ${row.count}x)</i>\n` +
        `<code>${proportionBar(share)}</code>`,
    );
  }
  return blocks.join('\n');
}

export const HELP = [
  '💰 <b>Bot Jejak Rupiah</b>',
  DIVIDER,
  'Catat pengeluaran & pemasukan langsung dari chat.',
  '',
  '<b>Cara pakai</b>',
  '<blockquote>makan siang nasi padang 25rb\n' +
    'gaji masuk 8.500.000\n' +
    'atau kirim foto struk belanja</blockquote>',
  '',
  '<b>Perintah</b>',
  '/rekap — ringkasan bulan ini',
  '/rekap <code>2026-10</code> — ringkasan bulan tertentu',
  '/riwayat — 10 transaksi terakhir',
  '/riwayat <code>20</code> — jumlah transaksi lain (maks 50)',
  '/riwayat <code>keluar</code> — hanya pengeluaran',
  '/export — unduh CSV transaksi bulan ini',
  '/hapus — hapus transaksi terakhir',
  '/start — pesan ini',
  '',
  '<i>Setiap hasil ekstraksi minta konfirmasi dulu sebelum dicatat.</i>',
].join('\n');

export function denialText(userId) {
  return `⛔ <b>Akses ditolak.</b> Bot ini privat. Telegram ID kamu: <code>${escapeHtml(userId)}</code>`;
}

/** Potong teks panjang tanpa memotong tag HTML (nilai sudah di-escape dulu). */
export function truncate(text, max = 60) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

const HISTORY_LABEL = {
  INCOME: 'Pemasukan',
  EXPENSE: 'Pengeluaran',
  null: 'Transaksi',
};

/** Hormati batas 4096 karakter per pesan Telegram. */
const HISTORY_CHAR_BUDGET = 3800;

/**
 * Daftar transaksi terakhir.
 * @param {Array<{ id: number, type: string, amount: string, category: string, note: string, transaction_date: Date | string }>} rows
 * @param {{ limit?: number, type?: 'INCOME' | 'EXPENSE' | null }} [options]
 */
export function renderHistoryView(rows, { limit = 10, type = null } = {}) {
  const kind = type === 'INCOME' || type === 'EXPENSE' ? type : null;
  const label = HISTORY_LABEL[String(kind)];

  const header = kind ? `🧾 ${limit} ${label} Terakhir` : `🧾 ${limit} Transaksi Terakhir`;

  if (rows.length === 0) {
    const empty =
      kind === 'EXPENSE'
        ? 'Belum ada pengeluaran tercatat.'
        : kind === 'INCOME'
          ? 'Belum ada pemasukan tercatat.'
          : 'Belum ada transaksi tercatat.';
    return `<b>${header}</b>\n${DIVIDER}\nℹ️ <i>${empty}</i>`;
  }

  const blocks = [`<b>${header}</b>`, DIVIDER];

  for (const [i, row] of rows.entries()) {
    const amount = `Rp ${new Intl.NumberFormat('id-ID').format(Number(row.amount) || 0)}`;
    blocks.push(
      `${i + 1}. ${TYPE_ICON[row.type]} <code>${amount}</code> <b>${escapeHtml(row.category)}</b>\n` +
        `    ${formatDate(row.transaction_date, config.timezone)} · <i>${escapeHtml(truncate(row.note || '-'))}</i>`,
    );
  }

  const footer = '<i>/hapus menghapus transaksi paling atas (terbaru).</i>';
  const full = [...blocks, '', footer].join('\n');
  if (full.length <= HISTORY_CHAR_BUDGET) return full;

  // Baris sudah tersambung per transaksi, jadi potong per blok.
  const kept = blocks.slice(0, 2);
  let size = kept.join('\n').length;
  let shown = 0;

  for (const block of blocks.slice(2)) {
    if (size + block.length + 1 > HISTORY_CHAR_BUDGET - 80) break;
    kept.push(block);
    size += block.length + 1;
    shown += 1;
  }

  kept.push('', `<i>… ${rows.length - shown} transaksi lain tidak ditampilkan.</i>`, footer);
  return kept.join('\n');
}

export const HISTORY_USAGE = [
  '<b>Format /riwayat</b>',
  '<code>/riwayat</code> — 10 transaksi terakhir',
  '<code>/riwayat 20</code> — 20 transaksi terakhir (maks 50)',
  '<code>/riwayat keluar</code> / <code>masuk</code> — filter tipe',
  '<code>/riwayat keluar 5</code> — gabung bebas',
].join('\n');

/**
 * Parse argumen /riwayat. Urutan bebas: angka + kata tipe.
 * Tidak melempar: pemanggil membalas HISTORY_USAGE kalau `error` terisi.
 * @param {string} [input]
 * @returns {{ limit: number, type: 'INCOME' | 'EXPENSE' | null, error: string | null }}
 */
export function parseHistoryArgs(input) {
  const tokens = String(input ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let limit = 10;
  let type = null;
  let sawNumber = false;

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const value = Number(token);
      if (value < 1) return { limit, type, error: 'Nominal jumlah harus lebih dari 0.' };
      if (sawNumber) return { limit, type, error: 'Jumlah hanya boleh disebut sekali.' };
      sawNumber = true;
      limit = clampHistoryLimit(value);
      continue;
    }

    if (token === 'keluar' || token === 'pengeluaran') {
      if (type && type !== 'EXPENSE') return { limit, type, error: 'Filter masuk dan keluar tidak bisa digabung.' };
      type = 'EXPENSE';
      continue;
    }

    if (token === 'masuk' || token === 'pemasukan') {
      if (type && type !== 'INCOME') return { limit, type, error: 'Filter masuk dan keluar tidak bisa digabung.' };
      type = 'INCOME';
      continue;
    }

    return { limit, type, error: `Argumen tidak dikenal: ${token}` };
  }

  return { limit, type, error: null };
}

/** Pesan sementara saat AI memproses; nanti diganti kartu konfirmasi. */
export const PROCESSING_TEXT = '⏳ <i>Membaca transaksi...</i>';
