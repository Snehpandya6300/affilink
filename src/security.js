import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export function visitorHash(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}|${process.env.ANALYTICS_SALT || 'affilink'}`).digest('hex').slice(0, 24);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Password must include at least one letter and one number.';
  return null;
}

export function cleanString(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return Boolean(url.hostname.includes('.'));
  } catch {
    return false;
  }
}

export function safeJsonArray(value) {
  if (Array.isArray(value)) return value.map((v) => cleanString(v, 80)).filter(Boolean).slice(0, 30);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return safeJsonArray(parsed);
    } catch {
      /* ignore */
    }
    return value.split(',').map((v) => cleanString(v, 80)).filter(Boolean).slice(0, 30);
  }
  return [];
}

export function slugify(value, fallback = 'program') {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || fallback;
}
