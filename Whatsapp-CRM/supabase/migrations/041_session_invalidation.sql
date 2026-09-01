-- Backs "Sign out everywhere" (Settings > Profile > Sessions). Sessions are
-- JWT-based with no server-side store, so this timestamp is the actual
-- revocation mechanism -- see the doc comment on users.session_invalidated_at
-- in schema.prisma and the jwt callback in src/auth.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_invalidated_at TIMESTAMPTZ;
