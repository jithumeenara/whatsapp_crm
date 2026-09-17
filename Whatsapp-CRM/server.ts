import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
// Relative import (not the "@/..." alias) -- server.ts runs directly via
// tsx from the project root, outside the alias resolution the rest of the
// app relies on.
import { sweepScheduledMessages } from "./src/lib/scheduled-messages/sweep";
import { sweepScheduledBroadcasts } from "./src/lib/broadcasts/sweep";
import { sweepWebsiteKnowledge } from "./src/lib/ai/knowledge-sweep";
import { attachLiveVoiceServer } from "./src/lib/ai/live-voice-server";
import { loadLiveVoiceContext } from "./src/lib/ai/live-voice-context";

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

  // Real-time voice console. A raw WebSocket rather than a socket.io
  // channel: this carries continuous binary audio, where socket.io's
  // framing and acknowledgement machinery is overhead in the one place
  // latency is audible. It claims only its own path and ignores every
  // other upgrade, so socket.io's own handshake is untouched.
  attachLiveVoiceServer(httpServer, loadLiveVoiceContext);

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

  // Scheduled/recurring conversation messages -- sends run from right here,
  // in this always-on process (PM2 keeps it alive), instead of depending on
  // an external cron job being set up. Runs every minute for as long as the
  // server is up; a brief failure (e.g. a DB blip) just gets retried on the
  // next tick.
  setInterval(() => {
    sweepScheduledMessages().catch((err) => {
      console.error("[scheduled-messages] sweep interval failed:", err);
    });
  }, 60_000);

  // Scheduled/recurring broadcasts -- same always-on-process pattern as
  // above, just a separate sweep since broadcasts and per-conversation
  // scheduled messages are unrelated tables with different send loops.
  setInterval(() => {
    sweepScheduledBroadcasts().catch((err) => {
      console.error("[broadcasts] sweep interval failed:", err);
    });
  }, 60_000);

  // Live knowledge re-sync -- websites (when the account asked for it)
  // and connected Google Sheets (always, since pointing at a sheet is
  // the request for it to stay current). Hourly: websites are only
  // touched after 24h, and a sheet edited now reaches the bot within
  // the hour, which is the granularity that was actually wanted.
  setInterval(() => {
    sweepWebsiteKnowledge().catch((err) => {
      console.error("[ai-knowledge] website sweep failed:", err);
    });
  }, 60 * 60_000);
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
