import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Kept on globalThis in production too: server.ts (the sweeps) and Next's
// compiled routes load this module separately in one process, and each
// copy used to open its own connection pool.
globalForPrisma.prisma = prisma;
