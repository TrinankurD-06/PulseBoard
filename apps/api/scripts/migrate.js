// npm run migrate: applies pending schema migrations (safe to run repeatedly).
import { connectMongo, disconnectMongo, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import { z } from 'zod';
import { runMigrations } from './migrations/index.js';

loadEnv();
const env = parseEnv(z.object({ MONGODB_URI: z.string().min(1) }));

async function main() {
  await connectMongo(env.MONGODB_URI);
  const ran = await runMigrations(mongoose.connection.db);
  console.warn(ran.length ? `Done: ${ran.join(', ')}` : 'Nothing to migrate.');
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
