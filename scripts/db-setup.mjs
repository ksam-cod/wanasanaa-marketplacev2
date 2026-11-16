import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reset = process.argv.includes('--reset');
const connectionString = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/wanasanaa';

const url = new URL(connectionString);
const databaseName = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'wanasanaa';

async function connect(target) {
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  return client;
}

async function openDatabase() {
  try {
    return await connect(connectionString);
  } catch (error) {
    if (error.code !== '3D000') throw error;
    const adminUrl = new URL(connectionString);
    adminUrl.pathname = '/postgres';
    const admin = await connect(adminUrl.toString());
    await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    await admin.end();
    console.log(`created database ${databaseName}`);
    return connect(connectionString);
  }
}

const client = await openDatabase();
try {
  if (reset) {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('dropped and recreated the public schema');
  }

  const schema = await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
  await client.query(schema);
  console.log('schema applied');
} finally {
  await client.end();
}

const { seedDatabase } = await import('../db/seed.mjs');
const { closePool, query } = await import('../server/db.js');

try {
  const result = await seedDatabase();
  if (result.seeded) {
    console.log('demo studios, artworks, orders, earnings, reviews and inquiries seeded');
  } else {
    console.log('database already has users — seed skipped (use `npm run db:reset` for a clean demo)');
  }

  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM users)::int AS users,
      (SELECT COUNT(*) FROM artists)::int AS artists,
      (SELECT COUNT(*) FROM artworks)::int AS artworks,
      (SELECT COUNT(*) FROM orders)::int AS orders,
      (SELECT COUNT(*) FROM earnings)::int AS earnings,
      (SELECT COUNT(*) FROM reviews)::int AS reviews,
      (SELECT COUNT(*) FROM inquiries)::int AS inquiries
  `);
  console.log('rows:', stats.rows[0]);
  console.log('\nDemo sign-ins (password: Wanasanaa2026!)');
  console.log('  collector  collector@wanasanaa.test');
  console.log('  studio     haku@wanasanaa.test   (Haku Atelier)');
  console.log('  studio     mael@wanasanaa.test   (Mael Nyx Atelier)');
} finally {
  await closePool();
}
