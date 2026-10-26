// Test-only helper (imported from test files, never from app code).
// A single-node replica set, not a standalone server, so change streams and
// transactions behave exactly like the docker-compose and Atlas setups.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo, ensureCollections } from '../db.js';

let replSet;

export async function startMemoryDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectMongo(replSet.getUri('pulseboard-test'));
  await ensureCollections();
  return replSet;
}

export async function stopMemoryDb() {
  await disconnectMongo();
  await replSet?.stop();
}

/** Empties every collection but keeps them (and their indexes) in place. */
export async function clearMemoryDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(
    collections
      .filter((collection) => !collection.collectionName.startsWith('system.'))
      .map((collection) => collection.deleteMany({})),
  );
}
