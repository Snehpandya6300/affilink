import { seedDatabase } from '../src/seed.js';
const created = seedDatabase();
console.log(created ? 'Database seeded.' : 'Database already contains data — skipped seeding.');
