/**
 * How far behind is the database this .env points at?
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * A local database drifts. Somebody pulls a fortnight of work, runs the
 * app, and gets `column X does not exist` — which names one missing
 * column and says nothing about the other nineteen. The instinct is
 * then to run every migration in the folder, and several of the early
 * ones (064 to 071) are not safe to re-run, so that turns one broken
 * column into a broken afternoon.
 *
 * This asks the database what it actually has, one yes-or-no per
 * migration, and prints the ones that are missing in the order they
 * have to run. It writes nothing.
 *
 *   npx tsx scripts/local-db-gap.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * One cheap, unambiguous check per migration.
 *
 * A table or a column that migration added and nothing else did — so a
 * `true` means that migration ran, not that something similar did.
 * Deliberately hand-written rather than derived from the SQL: a parser
 * would be wrong in exactly the cases that matter and nobody would
 * notice until it mattered.
 */
const CHECKS: Array<{ file: string; sql: string }> = [
  { file: '092_broadcast_inbox_quiet.sql', sql: col('broadcasts', 'show_in_inbox') },
  { file: '093_quick_links.sql', sql: col('profiles', 'quick_links') },
  { file: '094_quick_links_toggle.sql', sql: col('profiles', 'quick_links_enabled') },
  { file: '095_lead_sla.sql', sql: col('lead_settings', 'sla_warn_hours') },
  { file: '096_lead_views.sql', sql: table('lead_views') },
  { file: '097_ai_lead_detection.sql', sql: col('lead_settings', 'ai_lead_enabled') },
  { file: '098_ai_lead_verdict.sql', sql: col('leads', 'ai_verdict') },
  { file: '099_semantic_search_catchup.sql', sql: table('ai_knowledge_embeddings') },
  { file: '100_agent_presence.sql', sql: col('users', 'last_seen_at') },
  { file: '101_agent_went_offline.sql', sql: col('users', 'went_offline_at') },
  { file: '102_agent_working_hours.sql', sql: col('profiles', 'working_hours') },
  { file: '103_business_timezone.sql', sql: col('company_profiles', 'timezone') },
  { file: '104_ai_judgements.sql', sql: table('ai_judgements') },
  { file: '105_categories_and_scope.sql', sql: table('service_categories') },
  { file: '106_lead_last_customer_at.sql', sql: col('leads', 'last_customer_at') },
  { file: '107_conversation_offers.sql', sql: table('conversation_offers') },
]

function table(name: string): string {
  return `SELECT to_regclass('${name}') IS NOT NULL AS present`
}
function col(t: string, c: string): string {
  return `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${t}' AND column_name='${c}') AS present`
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  // Host and database only — never the password, which has no business
  // on a terminal somebody might screenshot.
  const where = url.replace(/^.*@/, '').replace(/\?.*$/, '')
  console.log(`Checking ${where || '(DATABASE_URL not set)'}\n`)

  const missing: string[] = []

  for (const check of CHECKS) {
    let present = false
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(check.sql)
      present = rows[0]?.present === true
    } catch {
      // A check that cannot run is reported as missing rather than
      // skipped: the useful failure here is the one that makes somebody
      // look, not the one that quietly passes.
      present = false
    }
    console.log(`${present ? '  ok ' : ' MISSING'}  ${check.file}`)
    if (!present) missing.push(check.file)
  }

  if (missing.length === 0) {
    console.log('\nUp to date.')
    return
  }

  console.log(`\n${missing.length} to run, in this order:\n`)
  for (const file of missing) {
    console.log(
      `npx prisma db execute --file supabase/migrations/${file} --schema prisma/schema.prisma`,
    )
  }
  console.log('\nThen: npx prisma generate')
  // Said every time, because the one migration somebody re-runs by
  // accident is always one of these.
  console.log('\nNote: 064–071 are NOT safe to re-run. Nothing above is in that range.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
