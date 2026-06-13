// Browser-side Supabase client stub. Previously returned a Supabase browser
// client. All files importing this should be migrated to call the relevant
// API routes instead (Prisma cannot run in the browser).
// This stub returns an object that throws on any DB call so broken imports
// surface at runtime rather than silently doing nothing.
export function createClient() {
  throw new Error(
    "[createClient] Supabase browser client has been removed. " +
      "Call an API route instead."
  );
}
