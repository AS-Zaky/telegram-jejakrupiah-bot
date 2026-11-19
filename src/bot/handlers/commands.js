import { InputFile } from 'grammy';
import { config } from '../../config.js';
import * as repo from '../../db/repo.js';
import { userMessage } from '../../services/errors.js';
import { formatRupiah, escapeHtml, parsePeriod, todayISO } from '../../utils/format.js';
import { logError } from '../../utils/log.js';
import {
  cancelledText,
  deletionCancelledText,
  deletionSuccessText,
  HELP,
  HISTORY_USAGE,
  NO_CONFIRMED_TEXT,
  PARSE_MODE,
  parseCallback,
  parseHistoryArgs,
  renderDeleteConfirmCard,
  renderHistoryView,
  reportText,
  savedText,
} from '../views.js';

const STALE_CARD_TEXT = '⚠️ Transaksi ini sudah diproses atau bukan milikmu.';
const DELETE_STALE_TEXT = '⚠️ Transaksi tidak ditemukan, sudah dihapus, atau bukan milikmu.';

export async function onStart(ctx) {
  await ctx.reply(HELP, PARSE_MODE);
}

/** /riwayat [jumlah] [keluar|masuk] — daftar transaksi CONFIRMED terakhir. */
export async function onRiwayat(ctx) {
  try {
    const { limit, type, error } = parseHistoryArgs(ctx.match);
    if (error) {
      await ctx.reply(`${escapeHtml(error)}\n\n${HISTORY_USAGE}`, PARSE_MODE);
      return;
    }

    const rows = await repo.getRecentTransactions(ctx.from.id, { limit, type });
    await ctx.reply(renderHistoryView(rows, { limit, type }), PARSE_MODE);
  } catch (error) {
    logError('[ERROR]', error);
    await ctx.reply(escapeHtml(userMessage(error)), PARSE_MODE);
  }
}

/** /hapus — tampilkan transaksi CONFIRMED terakhir + tombol konfirmasi. */
export async function onHapus(ctx) {
  try {
    const last = await repo.getLastConfirmedTransaction(ctx.from.id);
    if (!last) {
      await ctx.reply(NO_CONFIRMED_TEXT, PARSE_MODE);
      return;
    }

    const card = renderDeleteConfirmCard(last);
    await ctx.reply(card.text, { ...PARSE_MODE, reply_markup: card.reply_markup });
  } catch (error) {
    logError('[ERROR]', error);
    await ctx.reply(userMessage(error), PARSE_MODE);
  }
}

export async function onRekap(ctx) {
  const arg = ctx.match?.trim() || undefined;
  try {
    const period = parsePeriod(arg, todayISO(config.timezone));
    const rows = await repo.monthlyTotals(ctx.from.id, period.from, period.to);

    const income = rows.filter((r) => r.type === 'INCOME');
    const expense = rows.filter((r) => r.type === 'EXPENSE');

    await ctx.reply(reportText(period.label, income, expense, expense), PARSE_MODE);
  } catch (error) {
    logError('[ERROR]', error);
    await ctx.reply(escapeHtml(error.message), PARSE_MODE);
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function onExport(ctx) {
  try {
    const period = parsePeriod(ctx.match?.trim() || undefined, todayISO(config.timezone));
    const rows = await repo.confirmedBetween(ctx.from.id, period.from, period.to);

    if (rows.length === 0) {
      await ctx.reply(`ℹ️ Tidak ada transaksi <b>CONFIRMED</b> untuk ${escapeHtml(period.label)}.`, PARSE_MODE);
      return;
    }

    const header = ['no', 'id', 'tanggal', 'tipe', 'kategori', 'nominal', 'catatan'];
    const lines = [
      header.join(','),
      ...rows.map((r, idx) =>
        [
          idx + 1,
          r.id,
          r.transaction_date instanceof Date
            ? r.transaction_date.toISOString().slice(0, 10)
            : String(r.transaction_date).slice(0, 10),
          r.type,
          r.category,
          r.amount,
          r.note,
        ]
          .map(csvCell)
          .join(','),
      ),
    ];

    // Caption ringkas; isi CSV sebenarnya ada di file.
    const totalIncome = rows
      .filter((r) => r.type === 'INCOME')
      .reduce((sum, r) => sum + Number(r.amount), 0);
    const totalExpense = rows
      .filter((r) => r.type === 'EXPENSE')
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const caption =
      `<b>📄 Export ${escapeHtml(period.label)}</b>\n` +
      `${rows.length} transaksi\n` +
      `Pemasukan   : <code>${formatRupiah(totalIncome)}</code>\n` +
      `Pengeluaran : <code>${formatRupiah(totalExpense)}</code>\n` +
      `Selisih     : <code>${formatRupiah(totalIncome - totalExpense)}</code>`;

    // Buffer, bukan string: grammY memperlakukan argumen string sebagai path/URL
    // sehingga isi CSV (mengandung ':') dicoba di-parse jadi URL -> 400.
    // BOM \uFEFF di depan supaya Excel membaca UTF-8 (Rupiah & tanda baca rapi).
    const csvBuffer = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf-8');

    await ctx.replyWithDocument(new InputFile(csvBuffer, `${period.from.slice(0, 7)}-transaksi.csv`), {
      caption,
      ...PARSE_MODE,
    });
  } catch (error) {
    logError('[ERROR]', error);
    await ctx.reply(`⚠️ Gagal export: ${escapeHtml(error.message)}`, PARSE_MODE);
  }
}

export async function onCallback(ctx) {
  const {
    action,
    id,
    isTransaction,
    isDelete,
  } = parseCallback(ctx.callbackQuery?.data);
  const userId = ctx.from.id;

  await ctx.answerCallbackQuery();

  if (!isTransaction && !isDelete) {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    return;
  }

  try {
    if (isDelete) {
      await handleDeleteCallback(ctx, { action, id, userId });
      return;
    }

    if (action === 'confirm') {
      const saved = await repo.confirmPending(id, userId);
      if (!saved) {
        await ctx.editMessageText(STALE_CARD_TEXT, { ...PARSE_MODE, reply_markup: undefined }).catch(() => {});
        return;
      }
      // hapus keyboard = cegah double-klik
      await ctx.editMessageText(savedText(saved), { ...PARSE_MODE, reply_markup: undefined }).catch(() => {});
      return;
    }

    const deleted = await repo.cancelPending(id, userId);
    await ctx
      .editMessageText(deleted ? cancelledText() : STALE_CARD_TEXT, {
        ...PARSE_MODE,
        reply_markup: undefined,
      })
      .catch(() => {});
  } catch (error) {
    logError('[ERROR]', error);
    await ctx
      .editMessageText(escapeHtml(userMessage(error)), { ...PARSE_MODE, reply_markup: undefined })
      .catch((editError) => logError('[ERROR] gagal edit pesan:', editError));
  }
}

/** del_confirm / del_cancel: ownership divalidasi lagi di klausa WHERE SQL. */
async function handleDeleteCallback(ctx, { action, id, userId }) {
  if (action === 'del_cancel') {
    await ctx
      .editMessageText(deletionCancelledText(), { ...PARSE_MODE, reply_markup: undefined })
      .catch(() => {});
    return;
  }

  const removed = await repo.deleteConfirmedTransaction(id, userId);
  if (!removed) {
    await ctx.editMessageText(DELETE_STALE_TEXT, { ...PARSE_MODE, reply_markup: undefined }).catch(() => {});
    return;
  }

  await ctx
    .editMessageText(deletionSuccessText(removed), { ...PARSE_MODE, reply_markup: undefined })
    .catch(() => {});
}
