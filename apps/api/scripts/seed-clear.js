// npm run seed:clear: deletes the sample data created by `npm run seed`.
//
// Removes every document flagged `isSeed` (the fictional demo monitors and all
// their checks, incidents, rollups, usage, agent reports and scheduler jobs) and
// takes those monitors off status pages. Real monitors and their data, users,
// workspaces and alert channels are never touched. Safe to run twice.
// It asks no confirmation: it prints what it will delete first, then the counts.
import { connectMongo, disconnectMongo, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import { z } from 'zod';
import { clearSeedData, countSeedData } from './lib/seedClear.js';

loadEnv();

const LABELS = [
  ['monitors', 'seeded monitors'],
  ['incidents', 'incidents'],
  ['rollups', 'daily rollups'],
  ['checks', 'raw check results'],
  ['usage', 'usage records'],
  ['agentReports', 'agent reports'],
  ['jobs', 'scheduler jobs'],
  ['statusPages', 'status pages listing a seeded monitor'],
];

const describe = (counts) =>
  LABELS.map(([key, label]) => `  ${String(counts[key]).padStart(6)}  ${label}`).join('\n');

async function main() {
  const env = parseEnv(z.object({ MONGODB_URI: z.string().min(1) }));
  await connectMongo(env.MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;

  const planned = await countSeedData();
  console.warn(`Database "${dbName}": about to delete sample data (isSeed):\n${describe(planned)}`);
  console.warn('Real monitors, their data, users, workspaces and alert channels are kept.');

  const deleted = await clearSeedData({ logger: { warn() {} } });
  console.warn(`\nDeleted:\n${describe(deleted)}`);
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('Clearing seed data failed:', err.message);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
