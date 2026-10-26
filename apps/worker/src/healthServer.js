import http from 'node:http';

/**
 * The worker serves no HTTP API. This tiny server only answers GET /health so
 * the hosting platform can tell whether the process is alive and connected.
 * `getStatus` returns { healthy, ...details }.
 */
export function startHealthServer({ port, getStatus, logger }) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const { healthy, ...details } = await getStatus();
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', ...details }));
  });
  server.listen(port, () => logger.info(`Worker health endpoint on :${port}/health`));
  return server;
}
