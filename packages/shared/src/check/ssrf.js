// SSRF protection: stop users from making our servers request internal
// addresses (localhost, the private network, cloud metadata at 169.254.169.254).
// Node-only module (uses dns), never imported by the client.
import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network; 0.0.0.0 reaches localhost on many OSes
blocked.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blocked.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT (shared address space)
blocked.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, incl. cloud metadata endpoints
blocked.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blocked.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blocked.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved + broadcast
// IPv6
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addAddress('::1', 'ipv6'); // loopback
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local (private)
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast

/**
 * "::ffff:127.0.0.1" and "::ffff:7f00:1" are IPv4 addresses wearing an IPv6
 * costume. Unwrap them so they're checked against the IPv4 rules.
 */
function unwrapIpv4Mapped(ip) {
  const match = /^::ffff:(.+)$/i.exec(ip);
  if (!match) return null;
  const rest = match[1];
  if (net.isIPv4(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** True for any address we refuse to connect to. Non-IP input counts as private (fail closed). */
export function isPrivateIp(ip) {
  const mapped = unwrapIpv4Mapped(ip);
  if (mapped) return blocked.check(mapped, 'ipv4');
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) return blocked.check(ip, 'ipv6');
  return true;
}

export class UnsafeTargetError extends Error {
  constructor(message) {
    super(message);
    this.code = 'UNSAFE_TARGET';
  }
}

const lookupAll = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Validates a monitor URL before it is saved: http(s) only, no embedded
 * credentials, and every address the hostname resolves to must be public.
 * Throws UnsafeTargetError otherwise. `lookup` is injectable for tests.
 */
export async function assertSafeUrl(rawUrl, { allowPrivate = false, lookup = lookupAll } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeTargetError('Only http and https URLs can be monitored');
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError('URLs with embedded credentials are not allowed');
  }
  if (allowPrivate) return;

  // URL keeps IPv6 literals in brackets: "[::1]".
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname)).map((entry) => entry.address);
    } catch {
      throw new UnsafeTargetError(`Could not resolve host "${hostname}"`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new UnsafeTargetError(
      'Monitoring private, loopback or internal addresses is not allowed',
    );
  }
}

/**
 * A drop-in `lookup` for http.request that refuses private addresses at the
 * moment of connecting. Checking only when the monitor is saved isn't enough:
 * DNS can change later (DNS rebinding) and point a "public" name at 127.0.0.1.
 * Validating the exact address the socket will use closes that gap.
 */
export function createSafeLookup({ allowPrivate = false } = {}) {
  return function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err);
      const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
      if (!allowPrivate && addresses.some(isPrivateIp)) {
        return callback(
          new UnsafeTargetError(`Blocked connection to private address for "${hostname}"`),
        );
      }
      return callback(null, address, family);
    });
  };
}
