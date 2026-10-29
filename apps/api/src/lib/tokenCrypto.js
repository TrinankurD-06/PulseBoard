import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM encryption for provider access tokens stored at rest.
 *
 * The key is derived with HKDF-SHA256 from GITHUB_TOKEN_ENCRYPTION_KEY, or,
 * when that is not set, from JWT_REFRESH_SECRET, so a deployment works without
 * new configuration. (Rotating the key makes stored tokens undecryptable: the
 * user just signs in with GitHub again.)
 *
 * Output: "v1.<iv>.<tag>.<ciphertext>", each part base64url. A fresh random
 * 96-bit IV per call; the auth tag makes any tampering fail on decrypt.
 */
export function createTokenCrypto(env) {
  const secret = env.GITHUB_TOKEN_ENCRYPTION_KEY || env.JWT_REFRESH_SECRET;
  const key = Buffer.from(
    hkdfSync('sha256', secret, 'pulseboard', 'oauth-token-encryption/v1', 32),
  );

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },

    /** The plaintext, or null when the value is malformed, tampered with or the key changed. */
    decrypt(value) {
      try {
        const [version, iv, tag, data] = String(value).split('.');
        if (version !== VERSION || !iv || !tag || !data) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
          decipher.update(Buffer.from(data, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
