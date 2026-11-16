import { createApp } from './app.js';
import { config } from './config.js';
import { closePool, query } from './db.js';

const app = createApp();

async function start() {
  try {
    await query('SELECT 1');
  } catch (error) {
    console.error('[db] could not connect to PostgreSQL:', error.message);
    console.error(`[db] DATABASE_URL is set to ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    console.error('[db] Start the local cluster with `npm run db:start`, then `npm run db:setup`.');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`Wanasanaa API listening on ${config.appUrl} (${config.isProduction ? 'production' : 'development'})`);
    if (config.mpesa.simulate) {
      console.warn('[mpesa] simulation mode — authenticate a checkout and use the "Complete test payment" button, or POST /api/orders/:id/simulate-payment.');
    } else {
      console.log(`[mpesa] Daraja ${config.mpesa.env} · callback ${config.mpesa.callbackUrl}`);
    }
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down.`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
