// npm run seed: creates a ready-to-demo account.
//
//   login: demo@pulseboard.dev / demo1234
//   workspace "Acme Inc." with 7 monitors:
//     real sites (Google, GitHub, Example.com): created empty, they fill up from
//       the worker's first check
//     fictional "Demo API", "Demo Checkout", "Demo Cron Job" and "Demo Agent":
//       they watch the local demo-target and carry 30 days of daily rollups,
//       24 hours of raw checks, a few past incidents, this month's usage and the
//       last hour of agent reports. All of it is flagged isSeed (shown as
//       "Sample data") and removed by npm run seed:clear
//   an alert channel (from SEED_* variables in .env, else an Ethereal test inbox)
//   a public status page at /status/acme
//   apps/demo-target/.pulseboard-demo.json (git-ignored): the agent key and the
//     heartbeat URL, read by the demo-target and its heartbeat script
//
// Safe to run again: the previous demo account and its data are removed first.
// The agent key and heartbeat token in .pulseboard-demo.json are kept, so a
// demo-target or heartbeat script that is already running keeps working.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_KEY_PREFIX, MONITOR_TYPES, ROLES } from '@pulseboard/shared/constants';
import { connectMongo, disconnectMongo, ensureCollections, mongoose } from '@pulseboard/shared/db';
import { loadEnv, parseEnv } from '@pulseboard/shared/env';
import {
  AlertChannel,
  Membership,
  Monitor,
  Session,
  StatusPage,
  User,
} from '@pulseboard/shared/models';
import {
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { generateAgentKey, hashAgentKey } from '../src/modules/agent/agentKey.js';
import { generateHeartbeatToken } from '../src/modules/monitors/monitors.service.js';
import {
  createWorkspaceWithOwner,
  deleteWorkspace,
} from '../src/modules/workspaces/workspaces.service.js';
import { seedMonitors } from './lib/seedData.js';

loadEnv();
const env = parseEnv(
  z.object({
    MONGODB_URI: z.string().min(1),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    API_PORT: z.coerce.number().default(4000),
    DEMO_TARGET_PORT: z.coerce.number().default(4011),
    // Empty variables in .env mean "not set".
    SEED_DEMO_TARGET_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
    SEED_API_URL: z.preprocess((value) => value || undefined, z.string().url().optional()),
    // Force the local-only demo monitors on or off (default: on for a local database).
    SEED_LOCAL_DEMO: z.preprocess(
      (value) => value || undefined,
      z.enum(['true', 'false']).optional(),
    ),
    SEED_DISCORD_WEBHOOK_URL: z.string().optional(),
    SEED_SLACK_WEBHOOK_URL: z.string().optional(),
    SEED_ALERT_EMAIL: z.string().optional(),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  }),
);

const DEMO_EMAIL = 'demo@pulseboard.dev';
const DEMO_PASSWORD = 'demo1234';
const STATUS_SLUG = 'acme';
const now = Date.now();

const demoMode = env.DEMO_MODE === 'true';
const DEMO_TARGET_URL = env.SEED_DEMO_TARGET_URL ?? `http://localhost:${env.DEMO_TARGET_PORT}/`;
const API_URL = (env.SEED_API_URL ?? `http://localhost:${env.API_PORT}/api/v1`).replace(/\/$/, '');
// The demo target, the heartbeat and the agent only work beside a local demo-target
// and its heartbeat script, so on a hosted database they would sit there down and
// open incidents. They are seeded for a local database, when a public demo target
// is given, or when SEED_LOCAL_DEMO=true.
const LOCAL_DB = /\/\/(?:[^/@]*@)?(?:localhost|127\.0\.0\.1)[:/]/.test(env.MONGODB_URI);
const includeLocalDemo = env.SEED_LOCAL_DEMO
  ? env.SEED_LOCAL_DEMO === 'true'
  : LOCAL_DB || Boolean(env.SEED_DEMO_TARGET_URL);
const DEMO_FILE = fileURLToPath(
  new URL('../../demo-target/.pulseboard-demo.json', import.meta.url),
);
const AGENT_KEY_FORMAT = new RegExp(`^${AGENT_KEY_PREFIX}[A-Za-z0-9_-]{32}$`);
const HEARTBEAT_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

async function removePreviousDemo(scheduler) {
  const user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) return;
  const owned = await Membership.find({ userId: user._id, role: ROLES.OWNER }).lean();
  for (const { workspaceId } of owned) await deleteWorkspace(workspaceId, scheduler);
  await Promise.all([
    Membership.deleteMany({ userId: user._id }),
    Session.deleteMany({ userId: user._id }),
    user.deleteOne(),
  ]);
  console.warn('Removed the previous demo account and its data.');
}

/** The previous run's demo file, or {} when missing or unreadable. */
function readDemoFile() {
  try {
    return JSON.parse(readFileSync(DEMO_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Keeps the previous agent key and heartbeat token when they are well-formed
 * and no other monitor uses them (the demo monitors themselves were just
 * removed); otherwise new ones are generated.
 */
async function demoSecrets() {
  const previous = readDemoFile();
  const oldKey = typeof previous.agentKey === 'string' ? previous.agentKey : '';
  const keyFree =
    AGENT_KEY_FORMAT.test(oldKey) &&
    !(await Monitor.exists({ agentKeyHash: hashAgentKey(oldKey) }));
  const oldToken =
    typeof previous.heartbeatUrl === 'string'
      ? (previous.heartbeatUrl.split('/ping/')[1] ?? '')
      : '';
  const tokenFree =
    HEARTBEAT_TOKEN_FORMAT.test(oldToken) && !(await Monitor.exists({ heartbeatToken: oldToken }));
  return {
    agentKey: keyFree ? oldKey : generateAgentKey(),
    heartbeatToken: tokenFree ? oldToken : generateHeartbeatToken(),
    reused: { agentKey: keyFree, heartbeatToken: tokenFree },
  };
}

function alertChannelsFromEnv() {
  const channels = [];
  if (env.SEED_DISCORD_WEBHOOK_URL) {
    channels.push({
      name: '#ops (Discord)',
      type: 'discord',
      target: env.SEED_DISCORD_WEBHOOK_URL,
    });
  }
  if (env.SEED_SLACK_WEBHOOK_URL) {
    channels.push({ name: '#ops (Slack)', type: 'slack', target: env.SEED_SLACK_WEBHOOK_URL });
  }
  if (env.SEED_ALERT_EMAIL || channels.length === 0) {
    // Without SMTP settings this goes to an Ethereal test inbox (preview link in the timeline).
    channels.push({
      name: 'On-call inbox',
      type: 'email',
      target: env.SEED_ALERT_EMAIL || DEMO_EMAIL,
    });
  }
  return channels;
}

async function main() {
  await connectMongo(env.MONGODB_URI);
  await ensureCollections();
  const { agenda, close: closeAgenda } = createAgenda({ mongoUri: env.MONGODB_URI, name: 'seed' });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  await removePreviousDemo(scheduler);
  const secrets = await demoSecrets();

  const user = await User.create({
    name: 'Demo User',
    email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_COST),
  });
  const workspace = await createWorkspaceWithOwner({ name: 'Acme Inc.', ownerId: user._id });

  const { monitors, specs } = await seedMonitors({
    workspace,
    scheduler,
    secrets,
    includeLocalDemo,
    demoMode,
    demoTargetUrl: DEMO_TARGET_URL,
    now,
  });

  const channels = await AlertChannel.insertMany(
    alertChannelsFromEnv().map((channel) => ({ ...channel, workspaceId: workspace._id })),
  );

  const slugTaken = await StatusPage.exists({ slug: STATUS_SLUG });
  const statusPage = await StatusPage.create({
    workspaceId: workspace._id,
    slug: slugTaken ? `${STATUS_SLUG}-${workspace.slug.slice(-6)}` : STATUS_SLUG,
    title: 'Acme Status',
    description: 'Live availability of Acme Inc. services',
    monitorIds: monitors.map((monitor) => monitor._id),
    isPublic: true,
  });

  const heartbeatUrl = `${API_URL}/ping/${secrets.heartbeatToken}`;
  if (includeLocalDemo) {
    const agentSpec = specs.find((spec) => spec.type === MONITOR_TYPES.AGENT);
    const demoFile = {
      agentKey: secrets.agentKey,
      endpoint: API_URL,
      // The demo-target's agent reports at the interval the monitor expects.
      reportEverySec: agentSpec.reportEverySec,
      heartbeatUrl,
    };
    writeFileSync(DEMO_FILE, `${JSON.stringify(demoFile, null, 2)}\n`);
  }

  await closeAgenda();
  await disconnectMongo();

  const kept = (reused) => (reused ? ' (kept from the previous seed)' : '');
  const demoLines = includeLocalDemo
    ? `  Demo target:    ${DEMO_TARGET_URL}  (control panel: ${DEMO_TARGET_URL.replace(/\/$/, '')}/admin)
  Agent key:      ${secrets.agentKey}${kept(secrets.reused.agentKey)}
  Agent endpoint: ${API_URL}
  Heartbeat URL:  ${heartbeatUrl}${kept(secrets.reused.heartbeatToken)}
  Written to:     ${DEMO_FILE} (git-ignored; the demo-target reads it)
Start everything with: npm run dev
Then start the heartbeat by hand: npm run heartbeat -w @pulseboard/demo-target`
    : `  Skipped the fictional Demo monitors (API, Checkout, Cron Job, Agent): they need a local demo-target.
  Set SEED_LOCAL_DEMO=true to include them.`;
  console.warn(`
Seeded the demo account.
  Login:          ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  Workspace:      ${workspace.name} (${monitors.length} monitors, ${channels.length} alert channel${channels.length === 1 ? '' : 's'}: ${channels.map((c) => c.type).join(', ')})
  Status page:    /status/${statusPage.slug}
${demoLines}
`);
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
