/**
 * Re-fetches website-sourced knowledge entries for accounts that turned
 * "Auto-sync website" on, so a page edited on the business's own site
 * eventually reaches the bot without anyone clicking Re-sync.
 *
 * Runs from the same in-process interval server.ts already uses for
 * scheduled messages and broadcasts (no external cron required), plus an
 * HTTP trigger for deployments that prefer to drive it that way.
 *
 * Deliberately conservative: one pass touches only entries that haven't
 * been synced in the last 24h, a bounded number per pass, and a failure
 * keeps the previously-fetched copy rather than blanking the entry.
 * Embeddings are NOT regenerated here — a re-fetch marks the entry
 * 'pending', and the account's next Train run (or its next config save)
 * re-embeds it. Doing an unbounded number of embedding calls from a
 * background timer, against the account's own metered API key, is not
 * something to start without the account asking for it.
 */

import { prisma } from '@/lib/db'
import { fetchPageText } from './web-extract'

const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000
const MAX_PER_PASS = 20

export interface KnowledgeSweepResult {
  checked: number
  resynced: number
  failed: number
  unchanged: number
}

export async function sweepWebsiteKnowledge(): Promise<KnowledgeSweepResult> {
  const cutoff = new Date(Date.now() - RESYNC_AFTER_MS)

  const due = await prisma.aiKnowledgeItem.findMany({
    where: {
      kind: 'website',
      status: { not: 'disabled' },
      source_url: { not: null },
      ai_config: { auto_sync_website: true },
      OR: [{ last_synced_at: null }, { last_synced_at: { lt: cutoff } }],
    },
    orderBy: { last_synced_at: { sort: 'asc', nulls: 'first' } },
    take: MAX_PER_PASS,
    select: { id: true, source_url: true, content: true },
  })

  const result: KnowledgeSweepResult = { checked: due.length, resynced: 0, failed: 0, unchanged: 0 }

  for (const item of due) {
    if (!item.source_url) continue
    try {
      const page = await fetchPageText(item.source_url)
      if (page.text === item.content) {
        // Nothing changed — just record that it was checked, and leave
        // the status alone so an already-trained entry stays trained
        // instead of being needlessly re-embedded.
        await prisma.aiKnowledgeItem.update({
          where: { id: item.id },
          data: { last_synced_at: new Date(), last_error: null },
        })
        result.unchanged++
        continue
      }
      await prisma.aiKnowledgeItem.update({
        where: { id: item.id },
        data: { content: page.text, last_synced_at: new Date(), status: 'pending', last_error: null },
      })
      result.resynced++
    } catch (err) {
      await prisma.aiKnowledgeItem.update({
        where: { id: item.id },
        data: {
          status: 'failed',
          last_error: err instanceof Error ? err.message : 'Re-sync failed.',
          last_synced_at: new Date(),
        },
      })
      result.failed++
    }
  }

  return result
}
