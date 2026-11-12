import { seedDatabase } from '../src/seed.js';
import { closeDatabase, usingPostgres } from '../src/db.js';

const created = await seedDatabase();
console.log(
  `${created ? 'Database seeded' : 'Database already contains data — skipped seeding'} (${usingPostgres ? 'postgres' : 'sqlite'}).`
);
await closeDatabase();
