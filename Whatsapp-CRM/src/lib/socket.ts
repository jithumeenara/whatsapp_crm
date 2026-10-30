import type { Server as SocketIOServer } from "socket.io";

/**
 * Emit a real-time event to all sockets in an account's room.
 * Mirrors the emitToAccount export in server.ts — API routes import this
 * so they don't need to reach outside src/.
 */
export function emitToAccount(
  accountId: string,
  event: string,
  data: unknown,
): void {
  const io = (global as unknown as { io?: SocketIOServer }).io;
  if (io) {
    io.to(`account:${accountId}`).emit(event, data);
  }
}

/**
 * Close every live-update connection a user has, now — for a member
 * being removed, a password reset, "sign out everywhere". Without it an
 * open tab keeps receiving the account's messages until its connection
 * reaches its lifetime (src/lib/realtime-server.ts).
 */
export { disconnectUserSockets } from "./realtime-server";
