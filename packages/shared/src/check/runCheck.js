import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { evaluateCheck } from './evaluate.js';
import { createSafeLookup, isPrivateIp, UnsafeTargetError } from './ssrf.js';

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024; // only read for keyword checks
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Servers that don't implement HEAD answer like this; we then retry with GET.
const HEAD_UNSUPPORTED_STATUSES = new Set([405, 501]);

/**
 * Every check identifies itself, so customers can exclude PulseBoard traffic
 * from analytics and billing (explained on the public /bot page).
 * The marker header is set last, so custom headers can't remove it.
 */
export function checkHeaders({ appUrl, custom } = {}) {
  const botPage = appUrl ? ` (+${appUrl.replace(/\/$/, '')}/bot)` : '';
  return {
    'user-agent': `PulseBoard/1.0${botPage}`,
    accept: '*/*',
    connection: 'close',
    ...custom,
    'x-pulseboard-check': '1',
  };
}

class CheckTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Timed out after ${timeoutMs}ms`);
    this.code = 'CHECK_TIMEOUT';
  }
}

const now = () => process.hrtime.bigint();
const msBetween = (from, to) => (from != null && to != null ? Number(to - from) / 1e6 : 0);
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Turns socket event timestamps into the phase breakdown shown in the UI.
 * IP-literal URLs skip DNS (no "lookup" event), so dnsMs is 0 for them.
 */
function computeTimings(t, isHttps) {
  const afterDns = t.lookup ?? t.start;
  const beforeRequest = isHttps ? t.secureConnect : t.connect;
  return {
    dnsMs: round1(msBetween(t.start, t.lookup)),
    tcpMs: round1(msBetween(afterDns, t.connect)),
    tlsMs: round1(isHttps ? msBetween(t.connect, t.secureConnect) : 0),
    ttfbMs: round1(msBetween(beforeRequest, t.response)),
    downloadMs: round1(msBetween(t.response, t.end)),
  };
}

function readCertificateExpiry(socket) {
  const cert = typeof socket?.getPeerCertificate === 'function' && socket.getPeerCertificate();
  return cert?.valid_to ? new Date(cert.valid_to) : null;
}

/**
 * One HTTP request on a brand-new connection (agent: false, no keep-alive),
 * so DNS, TCP and TLS are measured on every check instead of being reused.
 */
function requestOnce(url, { method, headers, timeoutMs, readBody, allowPrivate }) {
  return new Promise((resolve, reject) => {
    // Node skips the DNS lookup for IP literals, so the safe lookup can't see
    // them; check those directly.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !allowPrivate && isPrivateIp(host)) {
      reject(new UnsafeTargetError('Blocked request to a private address'));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const t = { start: now() };
    let settled = false;

    const req = (isHttps ? https : http).request(url, {
      method,
      agent: false,
      lookup: createSafeLookup({ allowPrivate }),
      headers,
    });

    const timer = setTimeout(() => req.destroy(new CheckTimeoutError(timeoutMs)), timeoutMs);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    req.on('socket', (socket) => {
      socket.once('lookup', () => (t.lookup = now()));
      socket.once('connect', () => (t.connect = now()));
      socket.once('secureConnect', () => (t.secureConnect = now()));
    });

    req.on('response', (res) => {
      t.response = now();
      const sslExpiresAt = isHttps ? readCertificateExpiry(res.socket) : null;
      const chunks = [];
      let size = 0;

      const finish = () => {
        if (settled) return;
        settled = true;
        t.end = now();
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          location: res.headers.location,
          body: readBody ? Buffer.concat(chunks).toString('utf8') : null,
          timings: computeTimings(t, isHttps),
          sslExpiresAt,
        });
      };

      // No keyword to look for: we have the status and TTFB, so close the
      // connection now instead of downloading a body nobody reads.
      if (!readBody) {
        finish();
        res.destroy();
        return;
      }

      res.on('data', (chunk) => {
        chunks.push(chunk.subarray(0, MAX_BODY_BYTES - size));
        size += chunk.length;
        if (size >= MAX_BODY_BYTES) {
          // Enough for the keyword check; don't download a huge page.
          finish();
          res.destroy();
        }
      });
      res.on('end', finish);
      res.on('error', fail);
    });

    req.on('error', fail);
    req.end();
  });
}

/** Human-readable reason for a failed request, shown in the UI and alerts. */
export function describeNetworkError(err) {
  switch (err.code) {
    case 'CHECK_TIMEOUT':
    case 'UNSAFE_TARGET':
      return err.message;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'DNS lookup failed: host not found';
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
      return 'Connection reset by server';
    case 'ETIMEDOUT':
      return 'Connection timed out';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Host unreachable';
    default:
      if (/CERT|SSL|TLS/i.test(err.code ?? '')) return `TLS error: ${err.message}`;
      return err.message || 'Request failed';
  }
}

/**
 * Runs one uptime check. Never throws: every outcome is returned as data.
 *
 * @param target  { url, method, timeoutMs, headers, expectedStatus, keyword, headUnsupported }
 * @param options { allowPrivate, appUrl }
 * @returns { ok, statusCode, error, totalMs, timings, sslExpiresAt,
 *            requestsSent, headUnsupported }
 *
 * totalMs covers the whole check including redirects; timings describe the
 * final hop (the response that was evaluated). requestsSent counts every
 * request attempted (redirect hops and a HEAD->GET fallback included), for
 * usage tracking. headUnsupported is true when this check discovered that
 * the server rejects HEAD, so the caller can remember it.
 */
export async function runHttpCheck(target, { allowPrivate = false, appUrl } = {}) {
  const started = now();
  const deadline = Date.now() + target.timeoutMs;
  const custom =
    target.headers instanceof Map ? Object.fromEntries(target.headers) : target.headers;
  const headers = checkHeaders({ appUrl, custom });
  let url = new URL(target.url);
  // A server known to reject HEAD gets GET straight away (saves a request).
  let method =
    target.method === 'HEAD' && target.headUnsupported ? 'GET' : (target.method ?? 'GET');
  let requestsSent = 0;
  let headUnsupported = false;

  try {
    for (let redirects = 0; ;) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new CheckTimeoutError(target.timeoutMs);

      requestsSent += 1;
      const response = await requestOnce(url, {
        method,
        headers,
        timeoutMs: remainingMs,
        readBody: Boolean(target.keyword) && method !== 'HEAD',
        allowPrivate,
      });

      if (method === 'HEAD' && HEAD_UNSUPPORTED_STATUSES.has(response.statusCode)) {
        method = 'GET';
        headUnsupported = true;
        continue; // same URL again, not a redirect
      }

      if (REDIRECT_STATUSES.has(response.statusCode) && response.location) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
        }
        url = new URL(response.location, url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new UnsafeTargetError(`Redirect to unsupported protocol ${url.protocol}`);
        }
        // Same as browsers: 303 (and 301/302 after a POST) continue as GET.
        if (response.statusCode === 303 || (method === 'POST' && response.statusCode <= 302)) {
          method = 'GET';
        }
        continue;
      }

      const verdict = evaluateCheck(response, target);
      return {
        ok: verdict.ok,
        statusCode: response.statusCode,
        error: verdict.error,
        totalMs: round1(msBetween(started, now())),
        timings: response.timings,
        sslExpiresAt: response.sslExpiresAt,
        requestsSent,
        headUnsupported,
      };
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      error: describeNetworkError(err),
      totalMs: round1(msBetween(started, now())),
      timings: null,
      sslExpiresAt: null,
      requestsSent,
      headUnsupported,
    };
  }
}
