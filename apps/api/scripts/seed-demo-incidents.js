// npm run seed:demo-incidents: adds one fictional monitor with incident history to
// the demo account's workspace, for demos and recordings.
//
//   npm run seed:demo-incidents                      # demo@pulseboard.dev, its first workspace
//   npm run seed:demo-incidents -- --email you@x.com # another account's workspace
//
// Works for a read-only (Viewer) demo account too. It removes nothing else. Everything it creates is flagged isSeed (shown as "Sample
// data") and `npm run seed:clear` removes it. Running it twice replaces the monitor.
import { DEMO_USER_EMAIL } from '@pulseboard/shared/constants';
import { connectMongo, disconnectMongo, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import { Membership, User, Workspace } from '@pulseboard/shared/models';
import { z } from 'zod';
import { addDemoIncidentMonitor, DEMO_MONITOR_NAME } from '@pulseboard/shared/demo';

loadEnv();

const argIndex = process.argv.indexOf('--email');
const email = (argIndex > -1 ? process.argv[argIndex + 1] : DEMO_USER_EMAIL)?.toLowerCase();

async function main() {
  const env = parseEnv(z.object({ MONGODB_URI: z.string().min(1) }));
  await connectMongo(env.MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;

  const user = email ? await User.findOne({ email }).lean() : null;
  if (!user)
    throw new Error(`No user ${email ?? '(missing --email value)'} in database "${dbName}"`);
  const membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: 1 }).lean();
  const workspace = membership ? await Workspace.findById(membership.workspaceId).lean() : null;
  if (!workspace) throw new Error(`${email} has no workspace`);

  console.warn(
    `Database "${dbName}": adding "${DEMO_MONITOR_NAME}" to "${workspace.name}" (${email})...`,
  );
  const { monitor, incidents, replaced } = await addDemoIncidentMonitor({
    workspaceId: workspace._id,
  });
  console.warn(
    `${replaced ? 'Replaced the previous one. ' : ''}Created monitor ${monitor._id} with ${incidents} past incidents,\n` +
      '24 h of checks and 30 days of rollups (all flagged isSeed). Remove with: npm run seed:clear',
  );
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('Adding the demo monitor failed:', err.message);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
