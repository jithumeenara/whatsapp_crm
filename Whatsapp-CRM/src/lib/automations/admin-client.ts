// Re-export the shared Prisma client for the automation engine.
// Previously this was a Supabase service-role client; Prisma doesn't
// use RLS so no special admin client is needed — same instance works everywhere.
export { prisma as supabaseAdmin } from "@/lib/db";
