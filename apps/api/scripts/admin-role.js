// npm run admin:grant -- someone@example.com    makes an existing account a superadmin
// npm run admin:revoke -- someone@example.com   takes the role away again
//
// The only way, besides ADMIN_EMAILS / ADMIN_EMAIL at API start-up, to create a platform
// administrator: no screen or API can promote anyone. The public demo account is refused.
// Connects to MONGODB_URI from .env, so point it at the database you mean.
import { connectMongo, disconnectMongo, mongoose } from '@pulseboard/shared/db';
import { loadEnv } from '@pulseboard/shared/env';
import { grantSuperadmin, revokeSuperadmin } from '../src/modules/admin/platformAdmins.js';

loadEnv();

const [command, email] = process.argv.slice(2);
const MESSAGES = {
  granted: (e) => `${e} is now a superadmin.`,
  already: (e) => `${e} already is a superadmin.`,
  missing: (e) => `No account with the email ${e}. They must sign up first.`,
  demo: () => 'The demo account can never be a superadmin.',
  revoked: (e) => `${e} is no longer a superadmin.`,
  'not-admin': (e) => `${e} was not a superadmin.`,
};

async function main() {
  if (!['grant', 'revoke'].includes(command) || !email) {
    console.error('Usage: node scripts/admin-role.js grant|revoke someone@example.com');
    process.exit(2);
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (see .env)');
  await connectMongo(process.env.MONGODB_URI);
  console.warn(`Database "${mongoose.connection.db.databaseName}"`);
  const state = await (command === 'grant' ? grantSuperadmin : revokeSuperadmin)(email);
  console.warn(MESSAGES[state](email.trim().toLowerCase()));
  await disconnectMongo();
  if (state === 'missing' || state === 'demo') process.exit(1);
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await disconnectMongo().catch(() => {});
  process.exit(1);
});
