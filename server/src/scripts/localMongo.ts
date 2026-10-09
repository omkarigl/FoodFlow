import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Starts a standalone local MongoDB for development and prints the connection string.
 * Used by `npm run mongo:mem` and by the server when started with `--local-db`.
 */
async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create({
    instance: { dbName: 'foodflow', port: config.port === 27017 ? undefined : 27017 },
  });
  logger.info('mongo', `Local MongoDB ready: ${mongod.getUri()}`);
  process.stdout.write(`MONGODB_URI=${mongod.getUri()}\n`);

  const stop = async () => {
    await mongod.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  setInterval(() => undefined, 1 << 30);
}

main().catch((error) => {
  logger.error('mongo', (error as Error).message);
  process.exit(1);
});