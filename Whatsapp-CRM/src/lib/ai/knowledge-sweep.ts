/**
 * Re-fetches knowledge entries that have a live source behind them, so a
 * page edited on the business's own site — or a row changed in a shared
 * Google Sheet — eventually reaches the bot without anyone clicking
 * Re-sync.
 *
 * Runs from the same in-process interval server.ts already uses for
 * scheduled messages and broadcasts (no external cron required), plus an
 * HTTP trigger for deployments that prefer to drive it that way.
 *
 * Deliberately conservative: a bounded number of entries per pass, and a
 * failure keeps the previously-fetched copy rather than blanking the
 * entry — a site being down today should not erase knowledge that
 * answered questions yesterday.
 *
 * Embeddings are NOT regenerated here. A re-fetch marks the entry
 * 'pending', and the account's next Train run re-embeds it. Doing an
 * unbounded number of embedding calls from a background timer, against
 * the account's own metered API key, is not something to start without
 * being asked.
 *
 * ── Why sheets and websites are treated differently ─────────────────
 *
 * A website entry is a page someone grabbed once; keeping it current is
 * a nice-to-have, and it is gated behind the account's own "Auto-sync
 * website" switch. A Google Sheet is not that. Connecting a sheet *is*
 * the request for it to stay current — that is the entire reason to
 * point at a sheet instead of pasting its contents in — so sheets sync
 * without a separate switch, and on a shorter clock, because the fee
 * table changing and the bot not knowing is the exact failure this was
 * built to prevent.
 */

import { prisma } from '@/lib/db'
import { fetchPageText } from './web-extract'
import { fetchSheet, serializeSheet } from './google-sheet'

const WEBSITE_RESYNC_AFTER_MS = 24 * 60 * 60 * 1000
/** Sheets are cheap to read and are edited far more often than a
 *  website. The sweep itself only runs hourly, so this effectively means
 *  "every pass". */
const SHEET_RESYNC_AFTER_MS = 55 * 60 * 1000
const MAX_PER_PASS = 20

export interface KnowledgeSweepResult {
  checked: number
  resynced: number
  failed: number
  unchanged: number
}

export async function sweepWebsiteKnowledge(): Promise<KnowledgeSweepResult> {
  const result: KnowledgeSweepResult = { checked: 0, resynced: 0, failed: 0, unchanged: 0 }

  const due = await prisma.aiKnowledgeItem.findMany({
    where: {
      status: { not: 'disabled' },
      source_url: { not: null },
      OR: [
        {
          kind: 'website',
          ai_config: { auto_sync_website: true },
          OR: [
            { last_synced_at: null },
            { last_synced_at: { lt: new Date(Date.now() - WEBSITE_RESYNC_AFTER_MS) } },
          ],
        },
        {
          kind: 'sheet',
          OR: [
            { last_synced_at: null },
            { last_synced_at: { lt: new Date(Date.now() - SHEET_RESYNC_AFTER_MS) } },
          ],
        },
      ],
    },
    orderBy: { last_synced_at: { sort: 'asc', nulls: 'first' } },
    take: MAX_PER_PASS,
    select: { id: true, kind: true, source_url: true, content: true, description: true },
  })

  result.checked = due.length

  for (const item of due) {
    if (!item.source_url) continue
    try {
      const fresh =
        item.kind === 'sheet'
          ? serializeSheet(await fetchSheet(item.source_url), item.description)
          : (await fetchPageText(item.source_url)).text

      if (fresh === item.content) {
        // Nothing changed — record that it was checked and leave the
        // status alone, so an already-trained entry stays trained rather
        // than being needlessly re-embedded on the account's own key.
        await prisma.aiKnowledgeItem.update({
          where: { id: item.id },
          data: { last_synced_at: new Date(), last_error: null },
        })
        result.unchanged++
        continue
      }

      await prisma.aiKnowledgeItem.update({
        where: { id: item.id },
        data: { content: fresh, last_synced_at: new Date(), status: 'pending', last_error: null },
      })
      result.resynced++
    } catch (err) {
      // The previous content stays. A sheet that was un-shared, or a
      // site that is down, shows as failed on the Training tab with the
      // reason on the row — visible, and not destructive.
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
