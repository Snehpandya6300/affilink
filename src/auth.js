import { one, run, nowIso } from './db.js';
import { randomToken, verifyPassword } from './security.js';

export const SESSION_COOKIE = 'affilink_session';
const SESSION_DAYS = 14;

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function cookieOptions(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' || String(req.headers.host || '').includes('.style.dev');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  };
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

export function createSession(req, res, userId) {
  const token = randomToken(32);
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    token,
    userId,
    created.toISOString(),
    expires.toISOString()
  );
  setSessionCookie(req, res, token);
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  clearSessionCookie(req, res);
}

/** Attaches req.user (or null) from the session cookie. Safe for every request. */
export function attachUser(req, res, next) {
  req.user = null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const row = one(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.avatar_url, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
      token
    );
    if (row && new Date(row.expires_at).getTime() > Date.now() && row.status === 'active') {
      req.user = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        avatarUrl: row.avatar_url,
      };
    } else if (row) {
      run('DELETE FROM sessions WHERE token = ?', token);
      clearSessionCookie(req, res);
    }
  }
  next();
}

export function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' });
    }
    next();
  };
}

/** Basic CSRF hardening: state-changing requests must come from this origin. */
export function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    if (host !== req.headers.host) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid origin.' });
  }
  next();
}

export function attemptLogin(email, password) {
  const user = one('SELECT * FROM users WHERE lower(email) = lower(?)', String(email || '').trim());
  if (!user || !verifyPassword(password, user.password_hash)) return { error: 'Incorrect email or password.' };
  if (user.status !== 'active') return { error: 'This account has been suspended. Contact support.' };
  return { user };
}

export function currentStamp() {
  return nowIso();
}
