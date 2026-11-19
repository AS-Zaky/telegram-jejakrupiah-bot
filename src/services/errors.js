/**
 * Satu tipe error untuk semua kegagalan Gemini, supaya handler bisa memilih
 * pesan balasan User-friendly tanpa mencocokkan string.
 */
export class GeminiError extends Error {
  /** @param {'busy' | 'timeout' | 'failed' | 'empty' | 'invalid_json' | 'not_transaction'} kind */
  constructor(kind, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GeminiError';
    this.kind = kind;
  }
}

export function userMessage(error) {
  if (error?.kind === 'busy') {
    return '⏳ Server AI sedang sibuk, silakan kirim ulang dalam beberapa saat.';
  }
  if (error?.kind === 'timeout') {
    return '⏱️ Server AI terlalu lama merespons, silakan coba lagi.';
  }
  if (error?.kind === 'not_transaction') {
    return `🤔 ${error.message}`;
  }
  return `⚠️ Gagal memproses: ${error?.message ?? 'kesalahan tidak diketahui'}`;
}
