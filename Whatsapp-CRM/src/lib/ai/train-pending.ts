/**
 * Embedding what has changed, without anybody clicking Train now.
 *
 * ── The gap this closes ─────────────────────────────────────────────
 *
 * Everything that keeps knowledge *current* already runs on a timer. A
 * connected Data Store table is re-read, a Google Sheet is re-fetched, a
 * chatbot is re-serialised, a website is re-synced. Each of those, on
 * finding the content changed, marks the entry `pending` — and stopped
 * there.
 *
 * Nothing embedded it. `syncKnowledgeEmbeddings` had exactly one caller
 * in the whole app: the Train now button. So an account that edited a
 * table saw its entry go to "Not trained" and sit there, indefinitely,
 * waiting for a human to notice a badge on a settings screen. Semantic
 * search kept answering from the old vectors; keyword search saw the new
 * text. The two disagreed and nothing said so.
 *
 * That is the whole reason the sweeps exist — "the account edits the
 * table and the assistant should know" — and it was true for the text
 * and false for the embeddings.
 *
 * ── What this does not do ───────────────────────────────────────────
 *
 * It does not embed on a fixed schedule regardless of need.
 * `syncKnowledgeEmbeddings` already skips anything whose content hash it
 * has seen, so a pass over an unchanged knowledge base costs one query
 * and no provider calls. An account is billed for exactly the entries
 * that changed, which is what it would have paid by pressing the button.
 *
 * It also does not touch an account with no Gemini key: without one
 * there are no embeddings at all, retrieval falls back to keyword
 * search, and there is nothing here to do.
 */

import { prisma } from '@/lib/db'
import { loadKnowledge } from './knowledge-store'
import { chunkDocument } from './knowledge'
import { syncKnowledgeEmbeddings, toKnowledgeItems } from './embeddings'
import { geminiCredentials } from './providers/registry'

export interface TrainPendingResult {
  configsChecked: number
  embedded: number
  trained: number
  failed: number
}

/** Bounds one pass. A knowledge base this far out of date is a backlog,
 *  and working through it over a few passes is better than one run that
 *  holds a connection and a quota for minutes. */
const MAX_CONFIGS_PER_PASS = 20

export interface TrainConfigResult {
  /** Why nothing was attempted, when nothing was. */
  skipped: 'no_config' | 'knowledge_off' | 'no_gemini_key' | null
  embedded: number
  trained: number
  failed: number
  firstError: string | null
}

/**
 * Brings one account's embeddings in line with its knowledge base, and
 * marks entries trained only when nothing failed — the same thing the
 * Training tab's button does. Used by the timer below and by the Data
 * Store's own "Train now", so the two can never disagree about what
 * trained means.
 */
export async function trainKnowledgeConfig(configId: string): Promise<TrainConfigResult> {
  const none: TrainConfigResult = { skipped: null, embedded: 0, trained: 0, failed: 0, firstError: null }
  const config = await prisma.aiConfig.findUnique({
    where: { id: configId },
    select: { id: true, account_id: true, provider_keys: true, knowledge_base_enabled: true },
  })
  if (!config) return { ...none, skipped: 'no_config' }
  if (!config.knowledge_base_enabled) return { ...none, skipped: 'knowledge_off' }

  const { apiKey } = geminiCredentials(config)
  if (!apiKey) return { ...none, skipped: 'no_gemini_key' }

  // 'all', not 'customer': the audience boundary is applied at
  // retrieval time, so staff-only entries are embedded too and Admin
  // search can find them by meaning. Same call the button makes.
  const { qaPairs, documents } = await loadKnowledge(config.id, 'all')
  const items = toKnowledgeItems(qaPairs, documents.flatMap((doc) => chunkDocument(doc)))

  const synced = await syncKnowledgeEmbeddings({
    aiConfigId: config.id,
    apiKey,
    items,
    accountId: config.account_id,
  })

  // Only claim trained when nothing failed. A partial run leaving
  // everything green would hide the one entry that did not embed.
  let trained = 0
  if (synced.failed === 0) {
    const updated = await prisma.aiKnowledgeItem.updateMany({
      where: { ai_config_id: config.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'trained', last_error: null },
    })
    trained = updated.count
  }
  return {
    skipped: null,
    embedded: synced.embedded,
    trained,
    failed: synced.failed,
    firstError: synced.firstError ?? null,
  }
}

/**
 * Embeds every entry left `pending` or `failed`, for every account that
 * has some.
 *
 * Never throws: it runs on a timer in the process that serves WhatsApp.
 */
export async function trainPendingKnowledge(): Promise<TrainPendingResult> {
  const result: TrainPendingResult = { configsChecked: 0, embedded: 0, trained: 0, failed: 0 }

  let stale: Array<{ ai_config_id: string }>
  try {
    // distinct rather than groupBy: the question is "which configs have
    // something pending", and nothing here needs a count.
    stale = await prisma.aiKnowledgeItem.findMany({
      where: { status: { in: ['pending', 'failed'] } },
      select: { ai_config_id: true },
      distinct: ['ai_config_id'],
      orderBy: { ai_config_id: 'asc' },
      take: MAX_CONFIGS_PER_PASS,
    })
  } catch (err) {
    console.error('[auto-train] could not look for pending entries:', err instanceof Error ? err.message : err)
    return result
  }
  if (stale.length === 0) return result

  for (const { ai_config_id: configId } of stale) {
    result.configsChecked += 1
    try {
      const one = await trainKnowledgeConfig(configId)
      if (one.skipped) continue
      result.embedded += one.embedded
      result.failed += one.failed
      result.trained += one.trained
      if (one.failed > 0 && one.firstError) {
        console.warn(`[auto-train] ${configId}: ${one.failed} failed — ${one.firstError}`)
      }
    } catch (err) {
      // One account's failure must not stop the others.
      console.error('[auto-train] config', configId, 'failed:', err instanceof Error ? err.message : err)
    }
  }

  if (result.trained > 0 || result.failed > 0) {
    console.log(
      `[auto-train] embedded ${result.embedded}, marked ${result.trained} trained, ${result.failed} failed`,
    )
  }
  return result
}
