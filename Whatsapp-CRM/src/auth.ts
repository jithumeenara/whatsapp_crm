import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email / WhatsApp Number", type: "text" },
        password: { label: "Password", type: "password" },
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
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
