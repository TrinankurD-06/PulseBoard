// Pause history on the monitor, so uptime can leave paused time out of both
// downtime and watched time. Atomic and idempotent: opening twice or closing a
// pause that is not open does nothing.
import { Monitor } from '../models/index.js';

const MAX_PAUSES = 200;

export async function openPause(monitorId, at = new Date()) {
  await Monitor.collection.updateOne(
    { _id: monitorId, pauses: { $not: { $elemMatch: { to: null } } } },
    { $push: { pauses: { $each: [{ from: at, to: null }], $slice: -MAX_PAUSES } } },
  );
}

export async function closePause(monitorId, at = new Date()) {
  await Monitor.collection.updateOne(
    { _id: monitorId, 'pauses.to': null },
    { $set: { 'pauses.$[open].to': at } },
    { arrayFilters: [{ 'open.to': null }] },
  );
}
