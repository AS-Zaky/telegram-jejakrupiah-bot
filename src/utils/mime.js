/** MIME yang didukung Gemini untuk `inlineData`. */
export const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const MAGIC = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function startsWith(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
}

/** `RIFF....WEBP` — cek 4 byte pertama + 4 byte terakhir header. */
function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

/** @returns {string | null} */
export function mimeFromMagic(buffer) {
  if (!buffer?.length) return null;
  if (isWebp(buffer)) return 'image/webp';
  for (const { mime, bytes } of MAGIC) {
    if (startsWith(buffer, bytes)) return mime;
  }
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50) return 'application/pdf'; // %PDF
  return null;
}

/** @returns {string | null} */
export function mimeFromPath(filePath) {
  const ext = String(filePath ?? '').toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
  };
  return map[ext] ?? null;
}

/**
 * Telegram sering mengirim `content-type: application/octet-stream`, jadi header
 * hanya dipercaya kalau memang `image/*` atau `application/pdf`.
 * Urutan: magic bytes (paling jujur) -> header -> ekstensi -> null.
 * @param {Buffer} buffer
 * @param {string | null | undefined} header
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
export function resolveMime(buffer, header, filePath) {
  const fromMagic = mimeFromMagic(buffer);
  if (fromMagic) return fromMagic;

  const clean = String(header ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (SUPPORTED_MIME.has(clean)) return clean;

  return mimeFromPath(filePath);
}
