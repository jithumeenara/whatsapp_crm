"use client";

import { io, type Socket } from "socket.io-client";

/**
 * A socket to this account's live updates.
 *
 * The server admits a connection only with a ticket from
 * /api/realtime/ticket (see src/lib/realtime-ticket.ts). socket.io calls
 * `auth` before every connection attempt, reconnects included, so each
 * attempt carries a fresh one-minute ticket rather than one that expired
 * while the laptop was asleep.
 */
export function connectAccountSocket(): Socket {
  const socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: (cb) => {
      fetch("/api/realtime/ticket", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { ticket?: string } | null) => cb({ ticket: data?.ticket ?? "" }))
        .catch(() => cb({ ticket: "" }));
    },
  });
  reconnectWhenServerCloses(socket);
  return socket;
}

/**
 * The server closes each connection after a while so that it has to be
 * re-admitted with a fresh ticket (src/lib/realtime-server.ts). socket.io
 * does not reconnect by itself after a server-side close — it reads it as
 * "you were told to leave" — so this does, once, through the same `auth`
 * callback. If the session has ended there is no ticket, the server
 * refuses, and the socket stays down, which is the point.
 *
 * Synchronously, not after a delay: connect() marks the socket active at
 * once, and use-realtime.ts shares a socket only while it is connected
 * or active — a gap would let the next component open a second one.
 */
export function reconnectWhenServerCloses(socket: Socket): void {
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") socket.connect();
  });
}
