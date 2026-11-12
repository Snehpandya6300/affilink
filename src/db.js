import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
// Serverless hosts such as Vercel ship a read-only project directory, so the
// SQLite file lives in the one writable location they expose: the OS temp dir.
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'affilink-data') : path.join(ROOT, 'data'));
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  if (!fs.existsSync(DATA_DIR)) throw err;
}

const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'affilink.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
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
`);

// Columns added after the first release: keep existing databases usable.
const programColumns = db.prepare('PRAGMA table_info(affiliate_programs)').all().map((c) => c.name);
if (!programColumns.includes('source_url')) db.exec('ALTER TABLE affiliate_programs ADD COLUMN source_url TEXT;');
if (!programColumns.includes('verified_at')) db.exec('ALTER TABLE affiliate_programs ADD COLUMN verified_at TEXT;');

export function many(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function run(sql, ...params) {
  const res = db.prepare(sql).run(...params);
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
