import { Membership } from '@pulseboard/shared/models';
import { Server } from 'socket.io';
import { roomFor } from './events.js';

async function workspaceRooms(userId) {
  const memberships = await Membership.find({ userId }, { workspaceId: 1 }).lean();
  return memberships.map((membership) => roomFor(membership.workspaceId));
}

/** Leaves stale workspace rooms and joins the user's current ones. */
async function syncRooms(socket) {
  const rooms = new Set(await workspaceRooms(socket.data.userId));
  for (const room of socket.rooms) {
    if (room.startsWith('workspace:') && !rooms.has(room)) socket.leave(room);
  }
  socket.join([...rooms]);
  return [...rooms];
}

/**
 * Socket.io server. Browsers authenticate with the same short-lived access
 * token as REST calls (handshake `auth.token`), then automatically join one
 * room per workspace they belong to, and nothing else. Events are only ever
 * emitted to workspace rooms, so a user can't receive another workspace's data.
 */
export function createSocketServer(httpServer, { env, tokens, logger }) {
  const io = new Server(httpServer, {
    cors: { origin: [env.CLIENT_ORIGIN], credentials: true },
  });

  io.use((socket, next) => {
    const userId = tokens.verifyAccessToken(socket.handshake.auth?.token);
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on('connection', async (socket) => {
    try {
      await syncRooms(socket);
    } catch (err) {
      logger.error({ err }, 'Could not join workspace rooms');
      socket.disconnect(true);
      return;
    }
    // The client calls this after creating/joining/leaving a workspace.
    socket.on('workspaces:sync', async (ack) => {
      const rooms = await syncRooms(socket).catch(() => []);
      if (typeof ack === 'function') ack({ rooms: rooms.length });
    });
  });

  return io;
}
