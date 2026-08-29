import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { consumeLoginChallenge } from "@/lib/auth/mfa";

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
      async authorize(credentials) {
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

        return { id: user.id, email: user.email };
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
    jwt({ token, user, trigger }) {
      if (user?.id) token.id = user.id;
      // Idle-timeout tracking, seeded at sign-in. The ONGOING refresh path
      // is POST /api/heartbeat (re-signs and re-sets the cookie directly,
      // called by use-idle-timeout.ts on real activity) — not this
      // trigger:"update" branch, which flipping SessionProvider's shared
      // `loading` state on every call caused visible app-wide re-renders.
      // Kept here as a harmless fallback in case anything else ever calls
      // useSession().update() for an unrelated reason.
      if (user?.id || trigger === "update") token.lastActivity = Date.now();
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
