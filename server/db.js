import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  console.error('[db] idle client error', error.message);
});

export const query = (text, params) => pool.query(text, params);

/** Runs `fn` inside a transaction and rolls back on any thrown error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
