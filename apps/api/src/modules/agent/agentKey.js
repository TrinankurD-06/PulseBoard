import { createHash, randomBytes } from 'node:crypto';
import { AGENT_KEY_PREFIX } from '@pulseboard/shared/constants';

/** "pbk_" + 32 base64url characters (24 random bytes): unguessable, URL/header safe. */
export function generateAgentKey() {
  return `${AGENT_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

/**
 * Only this hash is stored. A plain SHA-256 is enough (no slow KDF): the key
 * is 192 random bits, not a human password, so it can't be brute-forced.
 */
export const hashAgentKey = (key) => createHash('sha256').update(key).digest('hex');

/** The stored fields for a key: hash for lookup, short prefix for display. */
export const agentKeyFields = (key) => ({
  agentKeyHash: hashAgentKey(key),
  agentKeyPrefix: key.slice(0, 8),
});
