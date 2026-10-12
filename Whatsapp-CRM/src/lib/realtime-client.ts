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
  return io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: (cb) => {
      fetch("/api/realtime/ticket", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { ticket?: string } | null) => cb({ ticket: data?.ticket ?? "" }))
        .catch(() => cb({ ticket: "" }));
    },
  });
}
