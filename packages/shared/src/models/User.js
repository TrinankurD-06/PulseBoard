import mongoose from 'mongoose';
import { OAUTH_PROVIDERS, PLATFORM_ROLES } from '../constants.js';
import { baseOptions, jsonOptions } from './_options.js';

const userJsonOptions = {
  ...jsonOptions,
  transform(doc, ret) {
    delete ret._id;
    // Only the provider names leave the server: provider account ids stay internal.
    // Guarded by isSelected so a partial load (e.g. populate 'name email') adds nothing.
    if (doc.isSelected?.('identities')) {
      ret.providers = [...new Set((doc.identities ?? []).map((identity) => identity.provider))];
    }
    if (doc.isSelected?.('passwordHash')) ret.hasPassword = Boolean(doc.passwordHash);
    delete ret.identities;
    delete ret.passwordHash;
    // Platform and moderation fields are for administrators, through their own serialisers: a
    // user's own profile (and every API that embeds one) does not carry them.
    delete ret.platformRole;
    delete ret.suspendedAt;
    delete ret.suspendedReason;
    delete ret.lastLoginAt;
    return ret;
  },
};

// A linked OAuth account. Google tokens are never stored. For GitHub the last
// access token is kept ENCRYPTED (AES-256-GCM, see apps/api/src/lib/tokenCrypto.js)
// so "Import from GitHub" can list public repos later; it is overwritten on every
// GitHub sign-in. The whole identities array is stripped from toJSON below.
const identitySchema = new mongoose.Schema(
  {
    provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
    providerId: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    // GitHub only: the username (for /users/{login}/repos) and the encrypted token.
    login: { type: String, trim: true },
    tokenEnc: { type: String },
    tokenScope: { type: String },
    tokenUpdatedAt: { type: Date },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false so the hash is never loaded unless explicitly asked for (login only).
    // Not required: users who signed up with Google/GitHub have no password.
    passwordHash: { type: String, select: false },
    identities: { type: [identitySchema], default: [] },
    // 'superadmin' is only ever set server-side: ADMIN_EMAILS / ADMIN_EMAIL at start-up, or
    // `npm run admin:grant`. No API or screen can promote anyone. The demo account can never be one.
    platformRole: {
      type: String,
      enum: Object.values(PLATFORM_ROLES),
      default: PLATFORM_ROLES.USER,
    },
    // Set by an administrator: the user cannot sign in and their monitors are paused.
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, trim: true, maxlength: 300, default: null },
    // The last time a sign-in (password or OAuth) started a session; refreshes do not count.
    lastLoginAt: { type: Date, default: null },
  },
  { ...baseOptions, toJSON: userJsonOptions, toObject: userJsonOptions },
);

// One provider account maps to at most one user. Partial, so the many users
// without identities (empty array, no indexed values) never collide.
// Migration 003 creates the same index on existing databases.
userSchema.index(
  { 'identities.provider': 1, 'identities.providerId': 1 },
  {
    name: 'identities_provider_providerId',
    unique: true,
    partialFilterExpression: { 'identities.providerId': { $exists: true } },
  },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
