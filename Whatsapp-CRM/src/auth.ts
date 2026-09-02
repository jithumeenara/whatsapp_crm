import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { consumeLoginChallenge } from "@/lib/auth/mfa";
import { getSessionInvalidatedAt } from "@/lib/auth/session-invalidation";
import { deriveDeviceLabel } from "@/lib/auth/device";

function getClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

// Only updated when it's at least this stale, so a session's normal use
// doesn't turn into a write on every single request.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

// A device that hasn't made a single request in this long is treated as
// abandoned and signed out automatically the next time anything checks
// it (either that device's own next request, or the Sessions list being
// viewed) — see the jwt callback and GET /api/account/sessions.
const INACTIVITY_LIMIT_MS = 3 * 24 * 60 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email / WhatsApp Number", type: "text" },
        password: { label: "Password", type: "password" },
        // Only present once /api/auth/mfa/start + verify have already
        // confirmed the user's OTP/TOTP code for this exact sign-in
        // attempt — see the MFA step in the login page and mfa.ts.
        challengeId: { label: "MFA Challenge", type: "text" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // Support phone-number login for agents.
        // Agents are stored with email = "{fullDigits}@agent.local" (country code included).
        // The agent may enter only the local number (without country code), so we
        // search for any @agent.local email that ENDS WITH the entered digits.
        let user;
        const raw = credentials.email as string;
        if (!raw.includes('@')) {
          const digits = raw.replace(/\D/g, '');
          // Try exact match first (entered number = stored number)
          user = await prisma.user.findUnique({
            where: { email: `${digits}@agent.local` },
          });
          // Fall back to suffix match for sufficiently long digit sequences.
          if (!user && digits.length >= 7) {
            user = await prisma.user.findFirst({
              where: { email: { endsWith: `${digits}@agent.local` } },
            });
          }
        } else {
          user = await prisma.user.findUnique({ where: { email: raw } });
        }

        if (!user || !user.password_hash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password_hash
        );
        if (!valid) return null;

        // MFA gate — password alone is never sufficient once a user has
        // opted in. The challengeId must be a 'login' challenge for THIS
        // user that was already verified by /api/auth/mfa/verify; consuming
        // it here (not just checking it) closes the replay window, so the
        // same verified code can't be reused for a second sign-in.
        if (user.mfa_method !== "disabled") {
          const challengeId = credentials.challengeId as string | undefined;
          if (!challengeId) return null;
          const consumed = await consumeLoginChallenge(challengeId, user.id);
          if (!consumed) return null;
        }

        // Real per-device session tracking (Settings > Profile > Sessions)
        // — one row per DEVICE, not per login: signing out and back in on
        // the same browser reuses (updates) its existing row instead of
        // piling up a new one every time, matched by the exact User-Agent
        // string (the best signal available without a persistent device
        // cookie). Failure here must never block sign-in, so it's wrapped
        // and just omits sessionId (jwt() below treats a token with no
        // sessionId as always valid, same as before this feature existed).
        let sessionId: string | undefined;
        try {
          const userAgent = request.headers.get("user-agent");
          const ipAddress = getClientIp(request);
          const existing = userAgent
            ? await prisma.userSession.findFirst({
                where: { user_id: user.id, user_agent: userAgent },
                orderBy: { last_seen_at: "desc" },
              })
            : null;

          if (existing) {
            await prisma.userSession.update({
              where: { id: existing.id },
              data: { last_seen_at: new Date(), revoked_at: null, ip_address: ipAddress },
            });
            sessionId = existing.id;
          } else {
            const session = await prisma.userSession.create({
              data: {
                user_id: user.id,
                device_label: deriveDeviceLabel(userAgent),
                user_agent: userAgent,
                ip_address: ipAddress,
              },
            });
            sessionId = session.id;
          }
        } catch (err) {
          console.error("Failed to create/update UserSession row:", err);
        }

        return { id: user.id, email: user.email, sessionId };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // Absolute cap — even an active user must re-authenticate after 8 hours.
    maxAge: 8 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      // NextAuth v5 uses "__Secure-" prefix in production (HTTPS) and the
      // bare name in development. Mirror that convention here.
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
        // Deliberately NO maxAge / expires → browser treats this as a
        // session cookie and deletes it when the window/tab is closed.
      },
    },
  },
  pages: {
    signIn: "/login",
    newUser: "/signup",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) token.id = user.id;
      // Real per-device session tracking — only set on the initial sign-in
      // call (when `user` is present); every later call just carries it
      // forward on `token` like `id` above.
      if (user && "sessionId" in user && user.sessionId) token.sessionId = user.sessionId;
      // Idle-timeout tracking, seeded at sign-in. The ONGOING refresh path
      // is POST /api/heartbeat (re-signs and re-sets the cookie directly,
      // called by use-idle-timeout.ts on real activity) — not this
      // trigger:"update" branch, which flipping SessionProvider's shared
      // `loading` state on every call caused visible app-wide re-renders.
      // Kept here as a harmless fallback in case anything else ever calls
      // useSession().update() for an unrelated reason.
      if (user?.id || trigger === "update") token.lastActivity = Date.now();

      // "Sign out everywhere" (Settings > Profile > Sessions) — reject any
      // token issued before the user's last invalidation, on every use.
      // This is what actually revokes a session under the JWT strategy;
      // returning null here is NextAuth's documented way to force the
      // caller to be treated as signed out.
      if (token.id) {
        const invalidatedAt = await getSessionInvalidatedAt(token.id as string);
        if (invalidatedAt && typeof token.iat === "number" && invalidatedAt.getTime() / 1000 > token.iat) {
          return null;
        }
      }

      // Per-device revocation ("Log out" on one row in Settings > Profile >
      // Sessions, as opposed to "Sign out everywhere" above). A token with
      // no sessionId (e.g. one issued before this feature existed, or a
      // login where the UserSession insert failed) is never rejected here
      // — absence of tracking must never itself become a lockout.
      if (token.sessionId) {
        try {
          const row = await prisma.userSession.findUnique({
            where: { id: token.sessionId as string },
            select: { revoked_at: true, last_seen_at: true },
          });
          if (row?.revoked_at) return null;
          // Auto-logout after 3 days with no activity at all on this
          // device — in practice the 8h maxAge above already ends a
          // truly-abandoned session long before this fires, but it's the
          // real enforcement point for it (not just hiding stale rows
          // from the Sessions list, which GET /api/account/sessions also
          // does on its own).
          if (row && Date.now() - row.last_seen_at.getTime() > INACTIVITY_LIMIT_MS) {
            prisma.userSession
              .update({ where: { id: token.sessionId as string }, data: { revoked_at: new Date() } })
              .catch((err) => console.error("Failed to auto-revoke inactive UserSession:", err));
            return null;
          }
          if (row && Date.now() - row.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS) {
            // Fire-and-forget — a slow write here must never delay the
            // response, and losing an occasional update is harmless.
            prisma.userSession
              .update({ where: { id: token.sessionId as string }, data: { last_seen_at: new Date() } })
              .catch((err) => console.error("Failed to update UserSession.last_seen_at:", err));
          }
        } catch (err) {
          console.error("Failed to check UserSession revocation:", err);
        }
      }

      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.sessionId) session.sessionId = token.sessionId as string;
      return session;
    },
  },
});
