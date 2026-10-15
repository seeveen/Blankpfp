export const MAX_SVG_BYTES = 100000;

const BLOCKED = [
  /<script/i,
  /<foreignObject/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<audio/i,
  /<video/i,
  /<link/i,
  /<meta/i,
  /<animate/i,
  /<set[\s>]/i,
  /<handler/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /vbscript:/i,
  /data:text\/html/i,
  /@import/i,
  /expression\s*\(/i,
  /url\(\s*['"]?\s*(https?:|\/\/)/i,
  // href só pode apontar para "#id" ou imagens embutidas (png/jpg/webp/gif)
  /(?:xlink:)?href\s*=\s*["'](?!#)(?!data:image\/(?:png|jpe?g|webp|gif);base64,)/i,
];

/** Valida e limpa um SVG enviado. Retorna { ok:true, svg } ou { ok:false, error }. */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Arquivo SVG inválido.' };
  if (input.length > MAX_SVG_BYTES) return { ok: false, error: 'O SVG passa de 100 KB.' };
  let s = input.replace(/^\uFEFF/, '').trim();
  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (/<!doctype|<!entity/i.test(s)) return { ok: false, error: 'SVG com DOCTYPE/ENTITY não é aceito.' };
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return { ok: false, error: 'O arquivo precisa ser um SVG válido.' };
  for (const re of BLOCKED) {
    if (re.test(s)) return { ok: false, error: 'O SVG tem elementos não permitidos (scripts, links externos ou eventos).' };
  }
  const root = s.match(/^<svg[^>]*>/i)[0];
  const hasBox = /viewBox\s*=/i.test(root) || (/\swidth\s*=/i.test(root) && /\sheight\s*=/i.test(root));
  if (!hasBox) return { ok: false, error: 'O SVG precisa ter viewBox ou width e height.' };
  if (!/xmlns\s*=/i.test(root)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return { ok: true, svg: s };
}
