import type { DefaultSession } from "next-auth";

// Extends NextAuth's built-in types with the fields this app actually
// carries through the JWT/session — real per-device session tracking
// (see src/auth.ts, UserSession model) needs `sessionId` on all three so
// TypeScript checks the assignments in auth.ts's callbacks properly
// instead of relying on an implicit index signature.
declare module "next-auth" {
  interface User {
    sessionId?: string;
  }

  interface Session extends DefaultSession {
    sessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    sessionId?: string;
    lastActivity?: number;
  }
}
