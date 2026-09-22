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
  // Started at 092 when this was written, on the assumption that a
  // local database could not be further behind than that. It was —
  // `ai_configs.idle_close_after_minutes` (090) was missing and this
  // script reported everything clear, which is the one thing a tool
  // like this must never do. The range now begins where the drift
  // actually began.
  { file: '072_ai_accuracy_layer.sql', sql: table('ai_eval_cases') },
  { file: '073_cloud_voice_and_live.sql', sql: col('ai_configs', 'live_voice_enabled') },
  { file: '074_ai_auto_reply.sql', sql: col('ai_configs', 'ai_auto_reply_enabled') },
  { file: '075_account_tts_credentials.sql', sql: col('ai_configs', 'google_tts_credentials') },
  { file: '076_raw_insert_id_defaults.sql', sql: idDefault('instagram_config') },
  { file: '077_message_bot_source.sql', sql: col('messages', 'bot_source') },
  { file: '078_calls.sql', sql: table('calls') },
  { file: '079_contact_blocking.sql', sql: col('contacts', 'blocked_at') },
  { file: '080_call_forwarding.sql', sql: col('call_configs', 'call_forward_url') },
  { file: '081_flow_restart_guard.sql', sql: index('idx_flow_runs_restart_guard') },
  { file: '082_conversation_feedback.sql', sql: table('conversation_feedback') },
  { file: '083_quality_report_indexes.sql', sql: index('idx_messages_conversation_created') },
  { file: '084_ai_registration.sql', sql: col('data_tables', 'ai_can_register') },
  { file: '085_handoff_alerts.sql', sql: col('ai_configs', 'handoff_alert_enabled') },
  { file: '086_registration_uniqueness.sql', sql: col('data_tables', 'ai_unique_by') },
  { file: '087_registration_capacity.sql', sql: col('data_tables', 'ai_capacity_by') },
  { file: '088_new_contact_alerts.sql', sql: col('contact_capture_configs', 'new_contact_alert_enabled') },
  { file: '089_reasoning_effort.sql', sql: col('ai_configs', 'reasoning_effort') },
  // The column the dev server actually died on.
  { file: '090_idle_close.sql', sql: col('ai_configs', 'idle_close_after_minutes') },
  { file: '091_ai_can_start_chatbot.sql', sql: col('flows', 'ai_can_start') },
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
  { file: '108_conversation_offers_one_pending.sql', sql: index('conversation_offers_one_pending_idx') },
  { file: '109_page_access.sql', sql: col('profiles', 'page_access') },
  { file: '110_lead_lost_at.sql', sql: col('leads', 'lost_at') },
]

function table(name: string): string {
  return `SELECT to_regclass('${name}') IS NOT NULL AS present`
}
function col(t: string, c: string): string {
  return `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${t}' AND column_name='${c}') AS present`
}
/** Some migrations add neither a table nor a column — an index is the
 *  only trace they leave, so that is what gets asked about. */
function index(name: string): string {
  return `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='${name}') AS present`
}
/** 076 gives existing id columns a default instead of adding anything.
 *  One representative table stands in for the whole sweep — and it has
 *  to be one of the three the migration actually names, not any table
 *  that happens to have an id. Pointing this at `contacts` reported a
 *  migration missing minutes after it had run. */
function idDefault(t: string): string {
  return `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${t}' AND column_name='id' AND column_default IS NOT NULL) AS present`
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
  console.log('\nNote: 064–071 are NOT safe to re-run, and this list starts at 072.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
