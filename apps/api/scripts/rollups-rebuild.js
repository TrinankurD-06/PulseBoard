// npm run rollups:rebuild: one-off that recalculates every stored daily rollup
// with the current uptime formula (confirmed incident downtime over watched time,
// leaving out paused and checker-offline time). Safe to run twice: each day is
// recomputed from scratch. Sample (seed) rows are left alone.
import { connectMongo, disconnectMongo, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import { rebuildAllRollups } from '@pulseboard/shared/rollup';
import { z } from 'zod';

loadEnv();

async function main() {
  const env = parseEnv(z.object({ MONGODB_URI: z.string().min(1) }));
  await connectMongo(env.MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;
  console.warn(`Database "${dbName}": rebuilding daily rollups...`);
  const { days, rows } = await rebuildAllRollups({
    onDay: (day, count) => console.warn(`  ${day.toISOString().slice(0, 10)}  ${count} rollups`),
  });
  console.warn(`Done: ${rows} rollups over ${days} days recalculated.`);
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('Rebuilding rollups failed:', err.message);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
