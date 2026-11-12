import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Delete the database files BEFORE importing db.js, otherwise the module keeps a
// handle open on the deleted inode and the reseed writes to a file nobody can see.
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const file of ['affilink.db', 'affilink.db-wal', 'affilink.db-shm']) {
  const p = path.join(DATA_DIR, file);
  if (fs.existsSync(p)) fs.rmSync(p);
}

const { seedDatabase } = await import('../src/seed.js');
seedDatabase();
console.log('Database reset and reseeded.');
