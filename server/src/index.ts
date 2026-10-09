import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { initRealtime, shutdownRealtime } from './services/realtime.service';
import { cancelExpiredUnpaidOrders, syncActiveOrderCounts } from './services/order.service';
import { logger } from './utils/logger';

let server: http.Server | null = null;
let sweeper: NodeJS.Timeout | null = null;

async function bootstrap(): Promise<void> {
  await connectDatabase();

  // User accounts live in Supabase — fail fast if the project/table is unreachable.
  const { checkSupabase } = await import('./services/userStore');
  try {
    await checkSupabase();
    logger.info('boot', 'Supabase user database connected.');
  } catch (error) {
    logger.error('boot', `Supabase user database unreachable: ${(error as Error).message}`);
    logger.error('boot', 'Run server/supabase/schema.sql in the Supabase SQL Editor, then restart.');
    process.exit(1);
  }

  if (process.argv.includes('--seed') || process.argv.includes('--seed-only')) {
    const { seedIfEmpty } = await import('./scripts/seedData');
    await seedIfEmpty(mongoose);
    if (process.argv.includes('--seed-only')) {
      logger.info('boot', 'Seed complete, exiting.');
      await disconnectDatabase();
      process.exit(0);
    }
  }

  // Recompute live order counters and expire abandoned checkouts on boot.
  await syncActiveOrderCounts();
  const expired = await cancelExpiredUnpaidOrders(30);
  if (expired > 0) logger.info('boot', `Cancelled ${expired} abandoned unpaid order(s).`);

  const app = createApp();
  server = http.createServer(app);
  initRealtime(server);

  await new Promise<void>((resolve) => server!.listen(config.port, resolve));
  logger.info('boot', `FoodFlow API listening on http://localhost:${config.port}`);

  sweeper = setInterval(() => {
    void cancelExpiredUnpaidOrders(30).catch((err) => logger.error('sweeper', (err as Error).message));
  }, 5 * 60 * 1000);
  sweeper.unref();
}

async function shutdown(signal: string): Promise<void> {
  logger.info('boot', `Received ${signal}, shutting down gracefully...`);
  if (sweeper) clearInterval(sweeper);
  shutdownRealtime();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (mongoose.connection.readyState !== 0) await disconnectDatabase();
  logger.info('boot', 'Shutdown complete.');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.error('process', `Unhandled rejection: ${(reason as Error)?.message ?? String(reason)}`);
});

process.on('uncaughtException', (err) => {
  logger.error('process', `Uncaught exception: ${err.message}`, err.stack);
  void shutdown('uncaughtException');
});

bootstrap().catch((error) => {
  logger.error('boot', `Failed to start FoodFlow: ${(error as Error).message}`);
  process.exit(1);
});