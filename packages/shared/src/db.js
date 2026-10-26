import mongoose from 'mongoose';
import { allModels } from './models/index.js';

mongoose.set('strictQuery', true);

export async function connectMongo(uri, logger) {
  mongoose.connection.on('disconnected', () => logger?.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger?.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger?.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

/**
 * Creates every collection and index up front. This matters most for
 * CheckResult: an insert into a missing collection would silently create a
 * regular collection instead of a time-series one.
 */
export async function ensureCollections() {
  await Promise.all(allModels.map((model) => model.init()));
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

/** 'connected' | 'disconnected' | 'connecting' | 'disconnecting' */
export function mongoState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][
    mongoose.connection.readyState
  ];
}

export { mongoose };
