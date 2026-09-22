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
import { sweepIdleConversations } from "./src/lib/ai/idle-close";
import { trainPendingKnowledge } from "./src/lib/ai/train-pending";
import { attachLiveVoiceServer } from "./src/lib/ai/live-voice-server";
import { loadLiveVoiceContext } from "./src/lib/ai/live-voice-context";
import { isClientGone } from "./src/lib/net/client-gone";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

/**
 * Which network interface to accept connections on.
 *
 * ── Why this is not simply "all of them" ────────────────────────────
 *
 * `listen(port)` with no host binds to every interface, so the app was
 * reachable on the server's public address as well as on loopback. A
 * firewall rule was the only thing standing between the internet and a
 * direct connection to Node — `ss` showed `*:3000`, and it was the UFW
 * default-deny alone that made that harmless.
 *
 * One rule is a thin place to keep a whole application. The cost of a
 * mistake there is not "port 3000 is open": nginx is what sets
 * `X-Real-IP` and strips whatever the caller claimed, so a request that
 * reaches Node without passing through nginx carries headers the caller
 * wrote. Every rate limit in this app is keyed on that value (see
 * src/lib/net/client-ip.ts), and so is every address a user sees on
 * their Sessions screen. Bypassing nginx does not just skip a proxy; it
 * hands the caller the identity the limiter counts.
 *
 * Binding to loopback means the kernel refuses that connection whether
 * or not the firewall is configured, so the two protections fail
 * independently instead of together.
 *
 * nginx proxies to `http://127.0.0.1:3000`, so this changes nothing
 * about how real traffic arrives. BIND_HOST exists for the deployment
 * where it must differ — a container, or a proxy on another host —
 * which then has to be a decision somebody makes rather than a default
 * nobody noticed.
 */
const bindHost = process.env.BIND_HOST ?? (dev ? "localhost" : "127.0.0.1");

// Log unhandled rejections with full stack so bugs are easy to find.
process.on("unhandledRejection", (reason) => {
  console.error(
    "[unhandledRejection]",
    reason instanceof Error ? reason.stack : reason,
  );
});

// A caller who hung up is not a crash. Ordinary disconnects used to
// arrive here — see src/lib/net/client-gone.ts — which forced this
// handler to be lenient about everything, including real faults. They
// are handled at the socket now, so anything that still reaches this
// point is a surprise and gets logged as one.
process.on("uncaughtException", (err) => {
  if (isClientGone(err)) return;
  console.error("[uncaughtException]", err.stack ?? err);
});

const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // Listen for the abort before handing the request on.
    //
    // When a browser abandons a request, Node emits an error on the
    // request object. With no listener attached, that error has nowhere
    // to go but `uncaughtException` — which is precisely the stack the
    // production log was full of. Attaching a listener is the whole fix;
    // there is nothing to do about a caller who has already left.
    req.on("error", (err) => {
      if (!isClientGone(err)) console.error("[request]", err);
    });
    res.on("error", (err) => {
      if (!isClientGone(err)) console.error("[response]", err);
    });

    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Connections that fail before they are a request at all: a socket
  // dropped mid-handshake, or a malformed request line. Node's default
  // is to destroy the socket and, in some cases, surface the error
  // globally. A dropped connection is simply closed; anything else is
  // told plainly that it was malformed, so a broken client sees a real
  // answer instead of silence.
  httpServer.on("clientError", (err, socket) => {
    if (isClientGone(err) || !socket.writable) {
      socket.destroy();
      return;
    }
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
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

  httpServer.listen(port, bindHost, () => {
    // Says the interface, not just the port, so a deployment that has
    // been opened up says so in its own first line of log.
    console.log(`> Ready on http://${hostname}:${port} (bound to ${bindHost})`);
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

  // Conversations the customer walked away from. Every five minutes,
  // which is fine granularity against a threshold measured in hours —
  // the setting's own minimum is five minutes, so this can never lag it
  // by more than one tick. A no-op for every account that has not asked
  // for it: the first query filters on the flag.
  setInterval(() => {
    sweepIdleConversations().catch((err) => {
      console.error("[idle-close] sweep interval failed:", err);
    });
  }, 5 * 60_000);

  // Embedding whatever the sweeps above left marked "Not trained".
  //
  // Those sweeps keep the *text* current and always have; nothing kept
  // the embeddings current, so a table somebody edited sat untrained
  // until a human noticed a badge on a settings screen. Ten minutes is
  // well inside the hour the content sweep runs on, and a pass over an
  // unchanged knowledge base costs one query and no provider calls —
  // syncKnowledgeEmbeddings skips every hash it has already seen.
  setInterval(() => {
    trainPendingKnowledge().catch((err) => {
      console.error("[auto-train] interval failed:", err);
    });
  }, 10 * 60_000);
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
