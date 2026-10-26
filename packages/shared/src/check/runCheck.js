import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { evaluateCheck } from './evaluate.js';
import { createSafeLookup, isPrivateIp, UnsafeTargetError } from './ssrf.js';

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024; // only read for keyword checks
const USER_AGENT = 'PulseBoard/1.0 (uptime monitor)';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
      headers: { 'user-agent': USER_AGENT, accept: '*/*', connection: 'close', ...headers },
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

      res.on('data', (chunk) => {
        if (!readBody) return; // still consumed, so download time is measured
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
 * @param target  { url, method, timeoutMs, headers, expectedStatus, keyword }
 * @returns { ok, statusCode, error, totalMs, timings, sslExpiresAt }
 *
 * totalMs covers the whole check including redirects; timings describe the
 * final hop (the response that was evaluated).
 */
export async function runHttpCheck(target, { allowPrivate = false } = {}) {
  const started = now();
  const deadline = Date.now() + target.timeoutMs;
  const headers =
    target.headers instanceof Map ? Object.fromEntries(target.headers) : target.headers;
  let url = new URL(target.url);
  let method = target.method ?? 'GET';

  try {
    for (let redirects = 0; ; redirects += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new CheckTimeoutError(target.timeoutMs);

      const response = await requestOnce(url, {
        method,
        headers,
        timeoutMs: remainingMs,
        readBody: Boolean(target.keyword) && method !== 'HEAD',
        allowPrivate,
      });

      if (REDIRECT_STATUSES.has(response.statusCode) && response.location) {
        if (redirects >= MAX_REDIRECTS) {
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
    };
  }
}
