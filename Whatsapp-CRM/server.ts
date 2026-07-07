import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

// Log unhandled rejections with full stack so bugs are easy to find.
process.on("unhandledRejection", (reason) => {
  console.error(
    "[unhandledRejection]",
    reason instanceof Error ? reason.stack : reason,
  );
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.stack ?? err);
});

const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_SITE_URL ?? "*",
      methods: ["GET", "POST"],
    },
  });

  // Expose io globally so API routes can emit events
  (global as unknown as { io: SocketIOServer }).io = io;

  io.on("connection", (socket) => {
    // Client joins a room scoped to their account for targeted broadcasts
    socket.on("join_account", (accountId: string) => {
      if (typeof accountId === "string" && accountId.length > 0) {
        socket.join(`account:${accountId}`);
      }
    });

    socket.on("leave_account", (accountId: string) => {
      socket.leave(`account:${accountId}`);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

/** Emit a real-time event to all sockets in an account's room. */
export function emitToAccount(
  accountId: string,
  event: string,
  data: unknown
) {
  const io = (global as unknown as { io?: SocketIOServer }).io;
  if (io) {
    io.to(`account:${accountId}`).emit(event, data);
  }
}
