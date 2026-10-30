import { PAUSED_REASONS } from '@pulseboard/shared/constants';
import { Incident, Monitor, Workspace } from '@pulseboard/shared/models';
import { notFound } from '../../lib/errors.js';
import {
  OBJECT_ID,
  clampPage,
  idString,
  loadMonitorContext,
  requireConfirmation,
  searchRegex,
} from './adminShared.js';
import { incidentRow, monitorRow, timelineRow } from './serializers.js';

const ROW_FIELDS =
  'name type url status isPaused pausedReason pauseNote workspaceId lastCheckedAt lastResponseMs lastOk';

/**
 * Monitors and incidents across every user. Pause and resume go through the SAME monitor service
 * the owners use (it cancels and re-creates the Agenda job and writes the pause history); the admin
 * only passes who is doing it.
 */
export function createMonitorsAdmin({ monitors }) {
  async function load(id) {
    if (!OBJECT_ID.test(id)) throw notFound('Monitor not found');
    const monitor = await Monitor.findById(id).select(ROW_FIELDS).lean();
    if (!monitor) throw notFound('Monitor not found');
    return monitor;
  }

  async function row(monitor) {
    const { workspaces, owners } = await loadMonitorContext([monitor]);
    return monitorRow(monitor, workspaces, owners);
  }

  const pause = async (monitor, note) => {
    if (monitor.isPaused) return false;
    await monitors.pause(monitor.workspaceId, idString(monitor._id), {
      reason: PAUSED_REASONS.ADMIN,
      note,
    });
    return true;
  };

  const resume = async (monitor) => {
    if (!monitor.isPaused) return false;
    await monitors.resume(monitor.workspaceId, idString(monitor._id), { byAdmin: true });
    return true;
  };

  return {
    async list({ status, type, workspaceId, ownerId, failing, search, ...paging } = {}) {
      const { page, limit } = clampPage(paging);
      const and = [];
      if (status) and.push({ status });
      if (type) and.push({ type });
      if (workspaceId) and.push({ workspaceId: OBJECT_ID.test(workspaceId) ? workspaceId : null });
      if (ownerId) {
        const owned = OBJECT_ID.test(ownerId)
          ? await Workspace.find({ ownerId }).distinct('_id')
          : [];
        and.push({ workspaceId: { $in: owned } });
      }
      if (failing) and.push({ $or: [{ status: 'down' }, { lastOk: false }] });
      if (search?.trim()) {
        const rx = searchRegex(search);
        and.push({ $or: [{ name: rx }, { url: rx }] });
      }
      const filter = and.length ? { $and: and } : {};
      const [total, docs] = await Promise.all([
        Monitor.countDocuments(filter),
        Monitor.find(filter)
          .select(ROW_FIELDS)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const { workspaces, owners } = await loadMonitorContext(docs);
      return {
        data: docs.map((m) => monitorRow(m, workspaces, owners)),
        pagination: { total, page, limit },
      };
    },

    async detail(id) {
      const monitor = await load(id);
      return { ...(await row(monitor)), workspaceId: idString(monitor.workspaceId) };
    },

    async snapshot(id) {
      const monitor = await load(id);
      return { name: monitor.name, status: monitor.status, isPaused: Boolean(monitor.isPaused) };
    },

    async pause(id, note) {
      const monitor = await load(id);
      const changed = await pause(monitor, note ?? null);
      return { ok: true, changed };
    },

    async resume(id) {
      const monitor = await load(id);
      const changed = await resume(monitor);
      return { ok: true, changed };
    },

    async test(id) {
      const monitor = await load(id);
      const result = await monitors.testExisting(monitor.workspaceId, idString(monitor._id));
      return {
        ok: Boolean(result.ok),
        statusCode: result.statusCode ?? null,
        totalMs: result.totalMs ?? null,
        error: result.error ?? null,
      };
    },

    async remove(id, { confirm }) {
      const monitor = await load(id);
      requireConfirmation(confirm, monitor.name, "the monitor's name");
      await monitors.remove(monitor.workspaceId, idString(monitor._id));
      return { ok: true };
    },

    async bulk({ action, ids, note, confirm }) {
      if (action === 'delete') requireConfirmation(confirm, 'DELETE', 'DELETE');
      const result = { changed: 0, skipped: 0, failed: [] };
      for (const id of ids) {
        let monitor = null;
        try {
          monitor = await load(id);
          let changed;
          if (action === 'pause') changed = await pause(monitor, note ?? null);
          else if (action === 'resume') changed = await resume(monitor);
          else {
            await monitors.remove(monitor.workspaceId, idString(monitor._id));
            changed = true;
          }
          if (changed) result.changed += 1;
          else result.skipped += 1;
        } catch (error) {
          result.failed.push({ id, name: monitor?.name ?? null, reason: error.message });
        }
      }
      return result;
    },

    // ---- incidents ----
    async listIncidents({ status = 'all', workspaceId, monitorId, search, ...paging } = {}) {
      const { page, limit } = clampPage(paging);
      const filter = {};
      if (status === 'open') filter.resolvedAt = null;
      if (status === 'resolved') filter.resolvedAt = { $ne: null };
      if (workspaceId) filter.workspaceId = OBJECT_ID.test(workspaceId) ? workspaceId : null;
      if (monitorId) filter.monitorId = OBJECT_ID.test(monitorId) ? monitorId : null;
      if (search?.trim()) filter.cause = searchRegex(search);
      const [total, docs] = await Promise.all([
        Incident.countDocuments(filter),
        Incident.find(filter)
          .select('monitorId workspaceId startedAt resolvedAt durationSec cause causeCode')
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const [monitorDocs, workspaceDocs] = await Promise.all([
        Monitor.find({ _id: { $in: docs.map((i) => i.monitorId) } })
          .select('name')
          .lean(),
        Workspace.find({ _id: { $in: docs.map((i) => i.workspaceId) } })
          .select('name')
          .lean(),
      ]);
      const monitorMap = new Map(monitorDocs.map((m) => [idString(m._id), m]));
      const workspaceMap = new Map(workspaceDocs.map((w) => [idString(w._id), w]));
      return {
        data: docs.map((i) => incidentRow(i, monitorMap, workspaceMap)),
        pagination: { total, page, limit },
      };
    },

    async incident(id) {
      if (!OBJECT_ID.test(id)) throw notFound('Incident not found');
      const incident = await Incident.findById(id)
        .select('monitorId workspaceId startedAt resolvedAt durationSec cause causeCode timeline')
        .lean();
      if (!incident) throw notFound('Incident not found');
      const [monitor, workspace] = await Promise.all([
        Monitor.findById(incident.monitorId).select('name').lean(),
        Workspace.findById(incident.workspaceId).select('name').lean(),
      ]);
      return {
        ...incidentRow(
          incident,
          new Map(monitor ? [[idString(monitor._id), monitor]] : []),
          new Map(workspace ? [[idString(workspace._id), workspace]] : []),
        ),
        timeline: (incident.timeline ?? []).map(timelineRow),
      };
    },
  };
}
