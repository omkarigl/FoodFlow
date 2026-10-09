import mongoose from 'mongoose';
import { config } from './env';
import { logger } from '../utils/logger';

type LocalMongoServer = { stop: () => Promise<boolean>; getUri: () => string };

let localServer: LocalMongoServer | null = null;

/**
 * Boots a real local MongoDB instance (mongodb-memory-server) when the server is
 * started with `--local-db`. Used for development without an Atlas cluster; the
 * database engine is genuine MongoDB, not a stub.
 */
export async function startLocalDatabase(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MongoMemoryServer } = require('mongodb-memory-server') as typeof import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create({ instance: { dbName: 'foodflow' } });
    localServer = mongod;
    const uri = mongod.getUri();
    logger.warn('mongo', `Using temporary local MongoDB at ${uri} (--local-db). Data is not persistent.`);
    return uri;
  } catch (error) {
    logger.error('mongo', `Failed to start local MongoDB: ${(error as Error).message}`);
    throw error;
  }
}

export async function stopLocalDatabase(): Promise<void> {
  if (localServer) {
    await localServer.stop().catch(() => undefined);
    localServer = null;
  }
}

export async function connectDatabase(): Promise<typeof mongoose> {
  const uri = config.useLocalDb ? await startLocalDatabase() : config.mongoUri;

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });

  logger.info('mongo', `Connected to MongoDB (${mongoose.connection.name})`);

  mongoose.connection.on('error', (err) => logger.error('mongo', `Connection error: ${err.message}`));
  mongoose.connection.on('disconnected', () => logger.warn('mongo', 'Disconnected from MongoDB'));

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  await stopLocalDatabase();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}