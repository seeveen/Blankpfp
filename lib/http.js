export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function getIp(req) {
  const h = req.headers;
  const fwd = h.get('x-vercel-forwarded-for') || h.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || h.get('x-real-ip') || '';
}

export async function readJson(req, limit = 600000) {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, 'Conteúdo grande demais.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

// Bloqueia requisições de outros sites (CSRF). Sem cabeçalho Origin (ex.: curl), deixa passar.
export function checkOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origem inválida.');
  }
  if (host && originHost !== host) throw new HttpError(403, 'Origem não permitida.');
}

export function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
