import { Router } from 'express';
import { one, insert, run, nowIso } from '../db.js';
import { attemptLogin, createSession, destroySession, requireAuth } from '../auth.js';
import {
  EMAIL_RE,
  cleanString,
  hashPassword,
  passwordProblem,
  randomToken,
  verifyPassword,
} from '../security.js';

const router = Router();
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function rateLimited(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start > WINDOW) {
    attempts.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

async function publicUser(user) {
  if (!user) return null;
  const base = { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatar_url || null };
  if (user.role === 'brand') {
    const profile = await one(`SELECT company_name, website, logo_url, country, about, contact_email FROM brand_profiles WHERE user_id = ?`, user.id);
    base.brandProfile = profile
      ? {
          companyName: profile.company_name,
          website: profile.website,
          logoUrl: profile.logo_url,
          country: profile.country,
          about: profile.about,
          contactEmail: profile.contact_email,
        }
      : null;
  }
  if (user.role === 'creator') {
    base.creatorProfile = (await one(`SELECT niche, audience_size, country FROM creator_profiles WHERE user_id = ?`, user.id)) || null;
  }
  return base;
}

router.get('/me', wrap(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = await one('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: await publicUser(user), demoAccounts: undefined });
}));

router.post('/register', wrap(async (req, res) => {
  const body = req.body || {};
  const name = cleanString(body.name, 80);
  const email = cleanString(body.email, 160).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'brand' ? 'brand' : 'creator';
  const companyName = cleanString(body.companyName, 100);
  const fields = {};

  if (name.length < 2) fields.name = 'Enter your full name.';
  if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
  const pwProblem = passwordProblem(password);
  if (pwProblem) fields.password = pwProblem;
  if (role === 'brand' && companyName.length < 2) fields.companyName = 'Enter your company name.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });
  if (await one('SELECT id FROM users WHERE lower(email) = ?', email)) {
    return res.status(409).json({ error: 'An account with that email already exists.', fields: { email: 'Email already registered.' } });
  }

  const now = nowIso();
  const userId = await insert(
    `INSERT INTO users (email, password_hash, name, role, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    email,
    hashPassword(password),
    name,
    role,
    'active',
    now,
    now
  );
  if (role === 'creator') {
    await run(
      `INSERT INTO creator_profiles (user_id, promo_methods, updated_at) VALUES (?, '[]', ?)`,
      userId,
      now
    );
  } else {
    await run(
      `INSERT INTO brand_profiles (user_id, company_name, contact_email, updated_at) VALUES (?,?,?,?)`,
      userId,
      companyName,
      email,
      now
    );
  }
  await createSession(req, res, userId);
  const user = await one('SELECT * FROM users WHERE id = ?', userId);
  res.status(201).json({ user: await publicUser(user), redirect: role === 'brand' ? '/brand/dashboard' : '/dashboard' });
}));

router.post('/login', wrap(async (req, res) => {
  const email = cleanString(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (rateLimited(`${req.ip}:${email}`)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  const result = await attemptLogin(email, password);
  if (result.error) return res.status(401).json({ error: result.error });
  attempts.delete(`${req.ip}:${email}`);
  await createSession(req, res, result.user.id);
  const redirect = result.user.role === 'admin' ? '/admin' : result.user.role === 'brand' ? '/brand/dashboard' : '/dashboard';
  res.json({ user: await publicUser(result.user), redirect });
}));

router.post('/logout', wrap(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

router.post('/forgot-password', wrap(async (req, res) => {
  const email = cleanString(req.body?.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.', fields: { email: 'Enter a valid email address.' } });
  const user = await one('SELECT id FROM users WHERE lower(email) = ?', email);
  const response = { message: 'If an account exists for that email, a reset link has been generated.' };
  if (user) {
    const token = randomToken(24);
    await run(
      `INSERT INTO password_resets (token, user_id, expires_at, used_at, created_at) VALUES (?,?,?,NULL,?)`,
      token,
      user.id,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      nowIso()
    );
    // No mail provider is configured, so the link is returned to the page directly.
    response.demoResetUrl = `/reset-password?token=${token}`;
  }
  res.json(response);
}));

router.post('/reset-password', wrap(async (req, res) => {
  const token = cleanString(req.body?.token, 120);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const problem = passwordProblem(password);
  if (!token) return res.status(400).json({ error: 'Reset token is missing.' });
  if (problem) return res.status(400).json({ error: problem, fields: { password: problem } });
  const row = await one('SELECT * FROM password_resets WHERE token = ?', token);
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), nowIso(), row.user_id);
  await run('UPDATE password_resets SET used_at = ? WHERE token = ?', nowIso(), token);
  await run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
  res.json({ message: 'Password updated. You can sign in now.', redirect: '/login' });
}));

router.post('/change-password', requireAuth(), wrap(async (req, res) => {
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const user = await one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(current, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.', fields: { currentPassword: 'Incorrect password.' } });
  }
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem, fields: { newPassword: problem } });
  await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(next), nowIso(), user.id);
  await run('DELETE FROM sessions WHERE user_id = ?', user.id);
  await createSession(req, res, user.id);
  res.json({ message: 'Password updated.' });
}));

export { publicUser };
export default router;
