import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
export const COOKIE = 'pfp_session';
export const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('hex');
export const newId = () => crypto.randomBytes(12).toString('hex');

// O IP nunca é guardado: só um hash com "sal" secreto.
export function hmac(value) {
  const key = process.env.IP_SALT || process.env.AUTH_SECRET || 'dev-only-salt';
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

export function isSecure(req) {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sessionCookie(token, { secure, maxAge }) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
