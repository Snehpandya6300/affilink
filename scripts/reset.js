import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isPostgres = Boolean(process.env.DATABASE_URL);

if (!isPostgres) {
  // Delete the database files BEFORE importing db.js, otherwise the module keeps
  // a handle open on the deleted inode and the reseed writes to a file nobody can see.
  const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of ['affilink.db', 'affilink.db-wal', 'affilink.db-shm']) {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

const { run, closeDatabase, migrate } = await import('../src/db.js');

if (isPostgres) {
  await migrate();
  await run(`TRUNCATE TABLE
      password_resets, creator_offers, contact_messages, sessions, site_content,
      testimonials, featured_programs, reviews, outbound_clicks, program_views,
      applications, saved_programs, affiliate_programs, categories,
      brand_profiles, creator_profiles, users
    RESTART IDENTITY CASCADE`);
}

const { seedDatabase } = await import('../src/seed.js');
await seedDatabase();
console.log(`Database reset and reseeded (${isPostgres ? 'postgres' : 'sqlite'}).`);
await closeDatabase();
