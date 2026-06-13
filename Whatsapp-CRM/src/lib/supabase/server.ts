// Compatibility shim — imports that previously expected a Supabase server
// client should be migrated to import { prisma } from "@/lib/db" and
// { auth } from "@/auth" directly. This file exists so the build doesn't
// fail while files are being migrated.
export { prisma as createClient } from "@/lib/db";
