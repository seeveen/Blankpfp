// Validação do conteúdo REAL dos arquivos (não confia em extensão nem no MIME enviado pelo navegador).
export const FORMATS_BY_TYPE = {
  accessory: ['svg'],
  face: ['svg'],
  shape: ['svg'],
  frame: ['svg', 'png'],
  background: ['svg', 'png', 'jpeg', 'webp'],
};
export const TYPE_LABEL = { accessory: 'Adereços', face: 'Rostos', shape: 'Formas', frame: 'Molduras', background: 'Fundos' };
export const MIME = { svg: 'image/svg+xml', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
export const MAX_RASTER_BYTES = 2 * 1024 * 1024;
export const MAX_DIM = 4096;

export function formatsText(type) {
  const names = FORMATS_BY_TYPE[type].map((f) => (f === 'jpeg' ? 'JPG' : f === 'webp' ? 'WebP' : f.toUpperCase()));
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names.slice(-1) : names[0];
  return `${TYPE_LABEL[type]} aceitam somente ${list}.`;
}

/** Decide o formato pelos primeiros bytes (assinatura mágica). */
export function detectRaster(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function pngSize(b) {
  if (b.length < 33 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b) {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) return null;
    let m = b[p + 1];
    while (m === 0xff && p + 2 < b.length) { p++; m = b[p + 1]; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    p += 2 + b.readUInt16BE(p + 2);
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30) return null;
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  return null;
}

/** Valida uma imagem raster. Retorna { ok, format, mime, width, height } ou { ok:false, error }. */
export function inspectRaster(buf) {
  if (!buf || buf.length < 24) return { ok: false, error: 'Arquivo de imagem inválido ou vazio.' };
  if (buf.length > MAX_RASTER_BYTES) return { ok: false, error: 'A imagem passa de 2 MB.' };
  const format = detectRaster(buf);
  if (!format) return { ok: false, error: 'O conteúdo não é PNG, JPG ou WebP válido.' };
  const size = format === 'png' ? pngSize(buf) : format === 'jpeg' ? jpegSize(buf) : webpSize(buf);
  if (!size || !size.width || !size.height) return { ok: false, error: 'Não consegui ler as dimensões da imagem (arquivo corrompido?).' };
  if (size.width > MAX_DIM || size.height > MAX_DIM) return { ok: false, error: `A imagem passa de ${MAX_DIM}×${MAX_DIM} pixels.` };
  return { ok: true, format, mime: MIME[format], width: size.width, height: size.height };
}

export function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x && x.buffer && x.position !== undefined) return Buffer.from(x.buffer).subarray(0, x.position); // BSON Binary
  return Buffer.from(x);
}
