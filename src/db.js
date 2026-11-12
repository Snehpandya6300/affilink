import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
// Serverless hosts such as Vercel ship a read-only project directory, so the
// SQLite fallback file lives in the one writable location they expose.
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'affilink-data') : path.join(ROOT, 'data'));

export const DATABASE_URL = process.env.DATABASE_URL || '';
export const usingPostgres = Boolean(DATABASE_URL);

/* ---------------------------------------------------------------------------
   Postgres (production). Used whenever DATABASE_URL is present.
--------------------------------------------------------------------------- */

let pool = null;
const txContext = new AsyncLocalStorage();

if (usingPostgres) {
  const pg = (await import('pg')).default;
  // Postgres returns BIGINT/NUMERIC as strings; this app treats those counts and
  // sums as numbers everywhere (same as the SQLite version did).
  pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
  pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX) || 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /sslmode=disable/.test(DATABASE_URL) || /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => console.error('[affilink] idle postgres client error', err.message));
}

/**
 * Postgres uses $1 placeholders and case-sensitive LIKE; the queries in this
 * codebase are written with SQLite syntax. Convert them in one place so every
 * call site stays readable. Quoted strings are skipped.
 */
export function toPostgres(sql) {
  let out = '';
  let param = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === '?') {
      param += 1;
      out += `$${param}`;
      continue;
    }
    out += ch;
  }
  return out.replace(/\bLIKE\b/g, 'ILIKE');
}

async function pgRun(sql, params) {
  const client = txContext.getStore()?.client;
  const runner = client || pool;
  return runner.query(toPostgres(sql), params);
}

/* ---------------------------------------------------------------------------
   SQLite (local development / fallback when no DATABASE_URL is configured).
--------------------------------------------------------------------------- */

let sqlite = null;

if (!usingPostgres) {
  const { DatabaseSync } = await import('node:sqlite');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    if (!fs.existsSync(DATA_DIR)) throw err;
  }
  const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'affilink.db');
  sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
}

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('creator','brand','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  avatar_url    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  website       TEXT,
  twitter       TEXT,
  linkedin      TEXT,
  instagram     TEXT,
  youtube       TEXT,
  niche         TEXT,
  audience_size TEXT,
  country       TEXT,
  promo_methods TEXT NOT NULL DEFAULT '[]',
  bio           TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name  TEXT NOT NULL,
  website       TEXT,
  logo_url      TEXT,
  contact_email TEXT,
  country       TEXT,
  about         TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT NOT NULL DEFAULT 'bi-grid',
  accent       TEXT NOT NULL DEFAULT '#6457f9',
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_programs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT NOT NULL UNIQUE,
  brand_name       TEXT NOT NULL,
  logo_url         TEXT,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  website_url      TEXT,
  signup_url       TEXT,
  commission_type  TEXT NOT NULL CHECK (commission_type IN ('percentage','recurring','fixed','tiered')),
  commission_value REAL NOT NULL DEFAULT 0,
  commission_label TEXT NOT NULL,
  commission_tiers TEXT,
  cookie_days      INTEGER NOT NULL DEFAULT 30 CHECK (cookie_days >= 0),
  min_payout       REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  payment_frequency TEXT NOT NULL DEFAULT 'Monthly',
  payment_methods  TEXT NOT NULL DEFAULT '[]',
  network          TEXT NOT NULL DEFAULT 'In-house',
  eligible_countries TEXT NOT NULL DEFAULT 'Worldwide',
  promo_methods    TEXT NOT NULL DEFAULT '[]',
  requirements     TEXT,
  contact_email    TEXT,
  brand_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  featured         INTEGER NOT NULL DEFAULT 0,
  is_demo          INTEGER NOT NULL DEFAULT 1,
  source_url       TEXT,
  verified_at      TEXT,
  view_count       INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  save_count       INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  approved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_programs_status ON affiliate_programs(status);
CREATE INDEX IF NOT EXISTS idx_programs_category ON affiliate_programs(category_id);
CREATE INDEX IF NOT EXISTS idx_programs_commission ON affiliate_programs(commission_value);
CREATE INDEX IF NOT EXISTS idx_programs_brand_user ON affiliate_programs(brand_user_id);
CREATE INDEX IF NOT EXISTS idx_programs_created ON affiliate_programs(created_at);

CREATE TABLE IF NOT EXISTS saved_programs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_programs(user_id);

CREATE TABLE IF NOT EXISTS applications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  applied_at TEXT NOT NULL,
  notes      TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id);

CREATE TABLE IF NOT EXISTS program_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visitor    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views_program ON program_views(program_id);
CREATE INDEX IF NOT EXISTS idx_views_user ON program_views(user_id, created_at);

CREATE TABLE IF NOT EXISTS outbound_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_program ON outbound_clicks(program_id);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author     TEXT NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_program ON reviews(program_id, status);

CREATE TABLE IF NOT EXISTS featured_programs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL UNIQUE REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS testimonials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  quote      TEXT NOT NULL,
  avatar_url TEXT,
  rating     INTEGER NOT NULL DEFAULT 5,
  status     TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  is_demo    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT 'General',
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_offers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  brand_name      TEXT NOT NULL,
  title           TEXT NOT NULL,
  category        TEXT,
  destination_url TEXT NOT NULL,
  commission_note TEXT,
  description     TEXT,
  clicks          INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_user ON creator_offers(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
`;

// Same shape as the SQLite schema, with Postgres types. Integer flag columns
// (featured, is_demo, is_active) intentionally stay integers so queries such as
// `featured = 1` keep working identically on both engines.
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('creator','brand','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  avatar_url    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  website       TEXT,
  twitter       TEXT,
  linkedin      TEXT,
  instagram     TEXT,
  youtube       TEXT,
  niche         TEXT,
  audience_size TEXT,
  country       TEXT,
  promo_methods TEXT NOT NULL DEFAULT '[]',
  bio           TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name  TEXT NOT NULL,
  website       TEXT,
  logo_url      TEXT,
  contact_email TEXT,
  country       TEXT,
  about         TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id           INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT NOT NULL DEFAULT 'bi-grid',
  accent       TEXT NOT NULL DEFAULT '#6457f9',
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_programs (
  id               INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  brand_name       TEXT NOT NULL,
  logo_url         TEXT,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  website_url      TEXT,
  signup_url       TEXT,
  commission_type  TEXT NOT NULL CHECK (commission_type IN ('percentage','recurring','fixed','tiered')),
  commission_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_label TEXT NOT NULL,
  commission_tiers TEXT,
  cookie_days      INTEGER NOT NULL DEFAULT 30 CHECK (cookie_days >= 0),
  min_payout       DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  payment_frequency TEXT NOT NULL DEFAULT 'Monthly',
  payment_methods  TEXT NOT NULL DEFAULT '[]',
  network          TEXT NOT NULL DEFAULT 'In-house',
  eligible_countries TEXT NOT NULL DEFAULT 'Worldwide',
  promo_methods    TEXT NOT NULL DEFAULT '[]',
  requirements     TEXT,
  contact_email    TEXT,
  brand_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  featured         INTEGER NOT NULL DEFAULT 0,
  is_demo          INTEGER NOT NULL DEFAULT 1,
  source_url       TEXT,
  verified_at      TEXT,
  view_count       INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  save_count       INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  approved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_programs_status ON affiliate_programs(status);
CREATE INDEX IF NOT EXISTS idx_programs_category ON affiliate_programs(category_id);
CREATE INDEX IF NOT EXISTS idx_programs_commission ON affiliate_programs(commission_value);
CREATE INDEX IF NOT EXISTS idx_programs_brand_user ON affiliate_programs(brand_user_id);
CREATE INDEX IF NOT EXISTS idx_programs_created ON affiliate_programs(created_at);

CREATE TABLE IF NOT EXISTS saved_programs (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_programs(user_id);

CREATE TABLE IF NOT EXISTS applications (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  applied_at TEXT NOT NULL,
  notes      TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id);

CREATE TABLE IF NOT EXISTS program_views (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visitor    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views_program ON program_views(program_id);
CREATE INDEX IF NOT EXISTS idx_views_user ON program_views(user_id, created_at);

CREATE TABLE IF NOT EXISTS outbound_clicks (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_program ON outbound_clicks(program_id);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author     TEXT NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_program ON reviews(program_id, status);

CREATE TABLE IF NOT EXISTS featured_programs (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  program_id INTEGER NOT NULL UNIQUE REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS testimonials (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  quote      TEXT NOT NULL,
  avatar_url TEXT,
  rating     INTEGER NOT NULL DEFAULT 5,
  status     TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  is_demo    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT 'General',
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_offers (
  id              INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  brand_name      TEXT NOT NULL,
  title           TEXT NOT NULL,
  category        TEXT,
  destination_url TEXT NOT NULL,
  commission_note TEXT,
  description     TEXT,
  clicks          INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_user ON creator_offers(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
`;

export async function migrate() {
  if (usingPostgres) {
    await pool.query(POSTGRES_SCHEMA);
    return;
  }
  sqlite.exec(SQLITE_SCHEMA);
  // Columns added after the first release: keep existing databases usable.
  const columns = sqlite.prepare('PRAGMA table_info(affiliate_programs)').all().map((c) => c.name);
  if (!columns.includes('source_url')) sqlite.exec('ALTER TABLE affiliate_programs ADD COLUMN source_url TEXT;');
  if (!columns.includes('verified_at')) sqlite.exec('ALTER TABLE affiliate_programs ADD COLUMN verified_at TEXT;');
}

export async function many(sql, ...params) {
  if (usingPostgres) {
    const result = await pgRun(sql, params);
    return result.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

export async function one(sql, ...params) {
  if (usingPostgres) {
    const result = await pgRun(sql, params);
    return result.rows[0] || null;
  }
  return sqlite.prepare(sql).get(...params) || null;
}

export async function run(sql, ...params) {
  if (usingPostgres) {
    const result = await pgRun(sql, params);
    return { changes: result.rowCount || 0, lastInsertRowid: null };
  }
  const result = sqlite.prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

/** INSERT that returns the new row id on both engines. */
export async function insert(sql, ...params) {
  if (usingPostgres) {
    const result = await pgRun(`${sql} RETURNING id`, params);
    return Number(result.rows[0].id);
  }
  const result = await run(sql, ...params);
  return result.lastInsertRowid;
}

export async function transaction(fn) {
  if (usingPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await txContext.run({ client }, fn);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  sqlite.exec('BEGIN');
  try {
    const out = await fn();
    sqlite.exec('COMMIT');
    return out;
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

export async function closeDatabase() {
  if (usingPostgres) {
    await pool.end();
    return;
  }
  sqlite.close();
}

export const nowIso = () => new Date().toISOString();
