// OAuth sign-in: users can have linked Google/GitHub identities.
//
// Existing users need no data change: a missing `identities` array reads as
// empty and their passwordHash stays. This only makes sure the unique index on
// (provider, providerId) exists. createIndex with the same name and options is
// a no-op when it is already there, so running this again changes nothing.
// Keep the definition identical to the one in packages/shared/src/models/User.js.
export const name = '003-user-identities';

export const IDENTITY_INDEX = {
  key: { 'identities.provider': 1, 'identities.providerId': 1 },
  options: {
    name: 'identities_provider_providerId',
    unique: true,
    partialFilterExpression: { 'identities.providerId': { $exists: true } },
  },
};

export async function up(db) {
  const index = await db
    .collection('users')
    .createIndex(IDENTITY_INDEX.key, IDENTITY_INDEX.options);
  return { modified: 0, index };
}
