/**
 * Schema patches that routes apply defensively — run once, not once per
 * request.
 *
 * ── The pattern this replaces ───────────────────────────────────────
 *
 * Several routes guard against a database that predates a column by
 * doing this at the top of the handler:
 *
 *     await prisma.$executeRaw`
 *       ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
 *     `.catch(() => {})
 *
 * The intent is sound: the route should work on an account whose
 * migration has not been run yet, rather than returning a 500 nobody
 * can interpret. The cost is what went unnoticed. `IF NOT EXISTS` makes
 * the statement a no-op, but a no-op is not free — it is still a
 * statement, still a network round trip, and still asks Postgres for a
 * lock on a table the whole application is reading.
 *
 * On the conversation-messages route that meant an ALTER TABLE against
 * the largest table in the database every time an agent clicked a
 * contact. On the lead-settings route it meant seventeen of them,
 * awaited one after another, every time the Leads page opened.
 *
 * ── Why once per process is the right frequency ─────────────────────
 *
 * Whether a column exists cannot change while this process is running.
 * Nothing but a migration changes it, and a migration is followed by a
 * restart. So the answer is fixed for the lifetime of the process, and
 * asking again is asking a question whose answer cannot have changed.
 *
 * ── What this deliberately does not do ──────────────────────────────
 *
 * It does not swallow failures forever. A patch that fails clears its
 * own record so the next caller retries; otherwise one transient
 * database blip at startup would be replayed to every request until
 * somebody restarted the app, and the logs would show a schema error
 * long after the schema was fine.
 *
 * It is also not a migration system. A patch here is a safety net under
 * `supabase/migrations/`, never a substitute for it — the migration is
 * what makes the column exist on purpose.
 */

/** In-flight or settled patches, by the key the caller named. */
const applied = new Map<string, Promise<void>>()

/**
 * Run `patch` the first time this key is seen, and never again.
 *
 * @param key    A stable name for the patch — "messages.deleted_at".
 *               Two callers using the same key share one run, which is
 *               the point when several routes guard the same column.
 * @param patch  The work. Usually one `$executeRaw`.
 */
export function onceSchemaPatch(key: string, patch: () => Promise<unknown>): Promise<void> {
  const existing = applied.get(key)
  if (existing) return existing

  const run = patch()
    .then(() => undefined)
    .catch((err) => {
      // Let the next caller try again rather than inheriting this
      // failure for the lifetime of the process.
      applied.delete(key)
      throw err
    })

  applied.set(key, run)
  return run
}

/** Testing only: forget what has been applied. */
export function __resetSchemaPatchesForTests() {
  applied.clear()
}
