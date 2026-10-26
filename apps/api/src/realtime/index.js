import { createChangeStreamWatcher, createCheckpointStore } from './changeStreams.js';
import {
  INCIDENT_PIPELINE,
  incidentChangeToEvent,
  MONITOR_PIPELINE,
  monitorChangeToEvent,
} from './events.js';

/**
 * Wires MongoDB change streams to Socket.io rooms:
 *   worker writes Monitor/Incident -> change stream -> io.to(workspace room).emit(...)
 *
 * The worker never talks to the API; the database is the message bus.
 * `io` only needs `to(room).emit(event, payload)`, so tests can pass a fake.
 */
export function startRealtime({ io, db, logger }) {
  const checkpoints = createCheckpointStore(db);
  const emit = (mapped) => mapped && io.to(mapped.room).emit(mapped.event, mapped.payload);

  const watch = (name, pipeline, toEvent) =>
    createChangeStreamWatcher({
      db,
      name,
      collection: name,
      pipeline,
      onChange: (change) => emit(toEvent(change)),
      checkpoints,
      logger,
    });
  const watchers = {
    monitors: watch('monitors', MONITOR_PIPELINE, monitorChangeToEvent),
    incidents: watch('incidents', INCIDENT_PIPELINE, incidentChangeToEvent),
  };
  const all = Object.values(watchers);

  const ready = Promise.all(all.map((watcher) => watcher.start()));

  return {
    ready,
    /** e.g. { monitors: 'live', incidents: 'live' }, reported by /health. */
    status: () =>
      Object.fromEntries(Object.entries(watchers).map(([name, w]) => [name, w.status()])),
    async close() {
      await Promise.all(all.map((watcher) => watcher.stop()));
      await checkpoints.flush();
    },
  };
}
