import { describe, expect, it } from 'vitest';
import { assertSafeUrl, createSafeLookup, isPrivateIp } from '../src/check/ssrf.js';

describe('isPrivateIp', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.8.8.8',
    '169.254.169.254', // AWS/GCP/Azure metadata
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // same, hex form
    '::ffff:a9fe:a9fe', // mapped 169.254.169.254
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.15.255.255', // just below 172.16/12
    '172.32.0.1', // just above
    '192.169.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  const fakeLookup = (addresses) => async () => addresses.map((address) => ({ address }));

  it('accepts a public IP literal', async () => {
    await expect(assertSafeUrl('https://1.1.1.1/health')).resolves.toBeUndefined();
  });

  it('rejects private IP literals, including bracketed IPv6', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:4001')).rejects.toMatchObject({
      code: 'UNSAFE_TARGET',
    });
    await expect(assertSafeUrl('http://[::1]/')).rejects.toMatchObject({ code: 'UNSAFE_TARGET' });
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
  });

  it('rejects a hostname if ANY resolved address is private', async () => {
    const lookup = fakeLookup(['93.184.216.34', '10.0.0.5']);
    await expect(assertSafeUrl('https://sneaky.example', { lookup })).rejects.toMatchObject({
      code: 'UNSAFE_TARGET',
    });
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    const lookup = fakeLookup(['93.184.216.34', '2606:2800:220:1::1']);
    await expect(assertSafeUrl('https://example.com', { lookup })).resolves.toBeUndefined();
  });

  it('rejects hosts that do not resolve', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertSafeUrl('https://nope.invalid', { lookup })).rejects.toThrow(
      /Could not resolve/,
    );
  });

  it('rejects non-http protocols and embedded credentials', async () => {
    await expect(assertSafeUrl('ftp://1.1.1.1')).rejects.toThrow(/http and https/);
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(/http and https/);
    await expect(assertSafeUrl('https://user:pass@1.1.1.1')).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('allows private targets when explicitly enabled (local demo)', async () => {
    await expect(
      assertSafeUrl('http://localhost:4001', { allowPrivate: true }),
    ).resolves.toBeUndefined();
  });
});

describe('createSafeLookup', () => {
  const lookupAsync = (lookup, host) =>
    new Promise((resolve, reject) => {
      lookup(host, {}, (err, address) => (err ? reject(err) : resolve(address)));
    });

  it('refuses to resolve to a private address at connect time', async () => {
    await expect(lookupAsync(createSafeLookup(), 'localhost')).rejects.toMatchObject({
      code: 'UNSAFE_TARGET',
    });
  });

  it('passes private addresses through when allowed', async () => {
    const address = await lookupAsync(createSafeLookup({ allowPrivate: true }), 'localhost');
    expect(isPrivateIp(address)).toBe(true);
  });
});
