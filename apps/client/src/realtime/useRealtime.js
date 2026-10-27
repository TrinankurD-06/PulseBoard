import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { analyticsKey, sparklinesKey } from '../api/analytics.js';
import { refreshAccessToken } from '../api/http.js';
import { monitorKeys } from '../api/monitors.js';
import { setRealtimeConnected } from '../api/realtimeState.js';
import { getAccessToken } from '../api/tokenStore.js';
import { useAuth } from '../auth/AuthContext.js';
import { createMetricsFolder } from './metricsLive.js';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const SPARKLINE_POINTS = 30;

const incidentsKey = (wid) => ['workspaces', wid, 'incidents'];

/** Patches cached monitor data in place: no refetch, so the UI updates instantly. */
function applyCheckResult(queryClient, { monitorId, workspaceId: wid, ...fields }) {
  const merge = (monitor) => (monitor?.id === monitorId ? { ...monitor, ...fields } : monitor);
  queryClient.setQueryData(monitorKeys.all(wid), (list) => list?.map(merge));
  queryClient.setQueryData(monitorKeys.detail(wid, monitorId), merge);

  // Append the new point to the dashboard sparkline (once per check).
  if (fields.lastCheckedAt && fields.lastResponseMs != null) {
    queryClient.setQueryData(sparklinesKey(wid), (all) => {
      if (!all) return all;
      const points = all[monitorId] ?? [];
      if (points.at(-1)?.t === fields.lastCheckedAt) return all;
      const point = { t: fields.lastCheckedAt, ms: fields.lastResponseMs, ok: fields.lastOk };
      return { ...all, [monitorId]: [...points, point].slice(-SPARKLINE_POINTS) };
    });
  }

  // Charts and uptime % for this monitor refetch, but only if a page shows them.
  queryClient.invalidateQueries({ queryKey: analyticsKey(wid, monitorId) });
}

function monitorName(queryClient, wid, monitorId) {
  const monitors = queryClient.getQueryData(monitorKeys.all(wid));
  return monitors?.find((m) => m.id === monitorId)?.name ?? 'A monitor';
}

/**
 * One Socket.io connection per logged-in session. Server events patch the
 * TanStack Query cache, so every page updates live without polling.
 * Returns { connected } for the "Live" indicator.
 */
export function useRealtime() {
  const queryClient = useQueryClient();
  const { status, workspaces } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;

    // auth as a function: every (re)connect sends the *current* access token.
    const socket = io(SOCKET_URL, {
      auth: (send) => send({ token: getAccessToken() }),
      transports: ['websocket'],
    });
    socketRef.current = socket;
    let everConnected = false;

    const setLive = (value) => {
      setConnected(value);
      setRealtimeConnected(value);
    };

    socket.on('connect', () => {
      setLive(true);
      // After a reconnect, refetch once to catch anything missed while offline.
      if (everConnected) queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      everConnected = true;
    });
    socket.on('disconnect', () => setLive(false));

    // The server rejects expired tokens; refresh once and try again.
    socket.on('connect_error', async (err) => {
      setLive(false);
      if (err.message !== 'unauthorized') return; // network error: socket.io retries itself
      try {
        await refreshAccessToken();
        socket.connect();
      } catch {
        // Refresh failed: the session is over and AuthProvider sends the user to login.
      }
    });

    // The Health deck folds each check into its cached metrics (throttled to 1/s).
    const metricsFolder = createMetricsFolder(queryClient);
    socket.on('check:result', (payload) => {
      applyCheckResult(queryClient, payload);
      metricsFolder.push(payload);
    });

    socket.on('incident:opened', (incident) => {
      queryClient.invalidateQueries({ queryKey: incidentsKey(incident.workspaceId) });
      toast.error(`${monitorName(queryClient, incident.workspaceId, incident.monitorId)} is down`, {
        description: incident.cause,
      });
    });
    socket.on('incident:resolved', (incident) => {
      queryClient.invalidateQueries({ queryKey: incidentsKey(incident.workspaceId) });
      toast.success(
        `${monitorName(queryClient, incident.workspaceId, incident.monitorId)} is back up`,
      );
    });
    socket.on('incident:updated', (incident) => {
      queryClient.invalidateQueries({ queryKey: incidentsKey(incident.workspaceId) });
    });

    return () => {
      metricsFolder.dispose();
      socket.disconnect();
      socketRef.current = null;
      setLive(false);
    };
  }, [status, queryClient]);

  // Joined/left/created a workspace: ask the server to update our rooms.
  const workspaceIds = workspaces.map((w) => w.id).join(',');
  useEffect(() => {
    if (socketRef.current?.connected) socketRef.current.emit('workspaces:sync');
  }, [workspaceIds]);

  return { connected };
}
