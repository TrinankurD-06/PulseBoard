const CHECKPOINTS = 'streamCheckpoints';
const MAX_RETRY_MS = 30_000;
// Events older than this when they arrive (e.g. replayed after a restart) still
// advance the resume token but aren't pushed to browsers: they'd be stale noise.
const MAX_EVENT_AGE_MS = 2 * 60 * 1000;
// Resume token no longer in the oplog (API was down too long): start fresh.
const HISTORY_LOST = new Set([260, 280, 286]);

/**
 * Stores the last processed resume token per stream in MongoDB, so after a
 * restart or reconnect the stream continues exactly where it stopped.
 * Writes are batched (at most once per `flushMs`) to avoid one extra write
 * per event.
 */
export function createCheckpointStore(db, { flushMs = 1000 } = {}) {
  const collection = db.collection(CHECKPOINTS);
  const pending = new Map();
  let timer = null;

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const entries = [...pending];
    pending.clear();
    await Promise.all(
      entries.map(([name, token]) =>
        collection.updateOne(
          { _id: name },
          { $set: { token, updatedAt: new Date() } },
          { upsert: true },
        ),
      ),
    );
  }

  return {
    async load(name) {
      return (await collection.findOne({ _id: name }))?.token ?? null;
    },
    save(name, token) {
      pending.set(name, token);
      timer ??= setTimeout(() => flush().catch(() => {}), flushMs);
    },
    flush,
    async clear(name) {
      pending.delete(name);
      await collection.deleteOne({ _id: name });
    },
  };
}

/**
 * Watches one collection and calls onChange for each matching event.
 *   - resumes from the stored token (no events lost across restarts)
 *   - on errors: logs, closes, and reopens with exponential backoff
 *     (1s, 2s, 4s, ... up to 30s)
 *   - status(): 'connecting' | 'live' | 'retrying' | 'stopped' (for /health)
 */
export function createChangeStreamWatcher({
  db,
  name,
  collection,
  pipeline,
  onChange,
  checkpoints,
  logger,
}) {
  let stream = null;
  let state = 'stopped';
  let stopped = false;
  let retryTimer = null;
  let retryMs = 1000;
  // Set when the stored token is too old, so the next open starts fresh
  // even if clearing the checkpoint hasn't finished yet.
  let skipResume = false;

  function scheduleRetry(err) {
    if (stopped || state === 'retrying') return;
    state = 'retrying';
    logger.warn({ stream: name, err: err?.message, retryInMs: retryMs }, 'Change stream error');
    const old = stream;
    stream = null;
    old?.close().catch(() => {});
    retryTimer = setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }

  async function handle(change) {
    retryMs = 1000; // healthy again
    const age = change.wallTime ? Date.now() - new Date(change.wallTime).getTime() : 0;
    if (age <= MAX_EVENT_AGE_MS) {
      try {
        await onChange(change);
      } catch (err) {
        logger.error({ stream: name, err }, 'Change handler failed');
      }
    }
    checkpoints.save(name, change._id);
  }

  async function open() {
    if (stopped) return;
    state = 'connecting';
    try {
      const resumeAfter = skipResume ? null : await checkpoints.load(name);
      skipResume = false;
      stream = db.collection(collection).watch(pipeline, {
        fullDocument: 'updateLookup',
        ...(resumeAfter && { resumeAfter }),
      });
      stream.on('change', handle);
      stream.on('error', (err) => {
        if (HISTORY_LOST.has(err?.code)) {
          logger.warn({ stream: name }, 'Resume token expired; restarting from now');
          skipResume = true;
          checkpoints.clear(name).catch(() => {});
        }
        scheduleRetry(err);
      });
      stream.on('close', () => scheduleRetry(new Error('stream closed')));
      state = 'live';
      logger.info({ stream: name, resumed: Boolean(resumeAfter) }, 'Change stream open');
    } catch (err) {
      scheduleRetry(err);
    }
  }

  return {
    start: open,
    status: () => state,
    async stop() {
      stopped = true;
      clearTimeout(retryTimer);
      const current = stream;
      stream = null;
      await current?.close().catch(() => {});
      state = 'stopped';
    },
  };
}
