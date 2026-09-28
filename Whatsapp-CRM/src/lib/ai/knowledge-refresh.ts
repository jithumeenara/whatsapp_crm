/**
 * Knowledge brought up to date within a minute of an edit.
 *
 * The text of a Q&A or document is read fresh on every message, but two
 * things lagged behind an edit: the search by meaning, which only knows
 * an entry once it is embedded (the training sweep ran every ten
 * minutes), and a connected Data Store table's text, re-read hourly. So a
 * row added at ten past was invisible to a customer for up to an hour,
 * and an edited answer was found by words but not by meaning.
 *
 * Now every edit schedules a refresh for its account, 45 seconds out.
 * Edits inside that window join the same run — a table being typed into
 * refreshes once, not per keystroke. The run re-reads only the tables
 * that changed and embeds only what is new: unchanged entries keep their
 * hashes and cost nothing. The hourly and ten-minute sweeps stay as the
 * safety net.
 *
 * Process-local timers, which is what this app runs on: one long-lived
 * server process (server.ts). A restart drops a pending refresh; the
 * sweeps pick it up.
 */

import { prisma } from '@/lib/db'
import { invalidateKnowledge } from './knowledge-store'
import { serializeDataTable } from './data-store-source'
import { trainKnowledgeConfig } from './train-pending'

export const REFRESH_DELAY_MS = 45_000

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const tablesWaiting = new Map<string, Set<string>>()

/** Something in this account's knowledge — or in one of its tables —
 *  changed. Safe to call on every edit. */
export function scheduleKnowledgeRefresh(accountId: string, tableId?: string | null): void {
  if (!accountId) return
  if (tableId) {
    const set = tablesWaiting.get(accountId) ?? new Set<string>()
    set.add(tableId)
    tablesWaiting.set(accountId, set)
  }
  if (timers.has(accountId)) return
  const timer = setTimeout(() => {
    timers.delete(accountId)
    const tables = [...(tablesWaiting.get(accountId) ?? [])]
    tablesWaiting.delete(accountId)
    void refreshNow(accountId, tables)
  }, REFRESH_DELAY_MS)
  // Never the reason the process stays alive.
  timer.unref?.()
  timers.set(accountId, timer)
}

/** The refresh itself: changed tables re-read, then anything pending
 *  embedded. Never throws. */
export async function refreshNow(accountId: string, tableIds: readonly string[]): Promise<void> {
  try {
    const config = await prisma.aiConfig.findUnique({
      where: { account_id: accountId },
      select: { id: true, knowledge_base_enabled: true },
    })
    if (!config?.knowledge_base_enabled) return

    for (const tableId of tableIds) {
      const item = await prisma.aiKnowledgeItem.findFirst({
        where: { ai_config_id: config.id, account_id: accountId, kind: 'database', source_ref: tableId },
        select: { id: true, content: true, description: true },
      })
      if (!item) continue // not connected to the assistant
      try {
        const fresh = (await serializeDataTable(accountId, tableId, item.description)).text
        if (fresh !== item.content) {
          await prisma.aiKnowledgeItem.update({
            where: { id: item.id },
            data: { content: fresh, last_synced_at: new Date(), status: 'pending', last_error: null },
          })
        }
      } catch (err) {
        // An emptied table and the like: the sweep reports it properly.
        console.warn('[knowledge-refresh] table', tableId, err instanceof Error ? err.message : err)
      }
    }

    invalidateKnowledge(config.id)
    const result = await trainKnowledgeConfig(config.id)
    invalidateKnowledge(config.id)
    if (result.failed > 0) console.warn(`[knowledge-refresh] ${accountId}: ${result.failed} not embedded — ${result.firstError}`)
  } catch (err) {
    console.error('[knowledge-refresh] failed:', err instanceof Error ? err.message : err)
  }
}
