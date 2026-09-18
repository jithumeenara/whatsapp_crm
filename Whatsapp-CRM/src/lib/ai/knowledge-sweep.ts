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
 * ── Why the three kinds are treated differently ─────────────────────
 *
 * A website entry is a page someone grabbed once; keeping it current is
 * a nice-to-have, and it is gated behind the account's own "Auto-sync
 * website" switch.
 *
 * A Google Sheet and a connected Data Store table are not that.
 * Connecting one *is* the request for it to stay current — that is the
 * entire reason to point at it instead of pasting its contents in — so
 * both sync without a separate switch, and on a shorter clock.
 *
 * The table case was missing entirely until a live transcript exposed
 * it: the account's Training table held one programme, the assistant
 * described several, and the knowledge entry behind it was a snapshot
 * taken on the day it was connected and never read again. Someone
 * editing the table in the CRM had no way to know the assistant was
 * still quoting the old version.
 */

import { prisma } from '@/lib/db'
import { fetchPageText } from './web-extract'
import { fetchSheet, serializeSheet } from './google-sheet'
import { serializeDataTable } from './data-store-source'
import { invalidateKnowledge } from './knowledge-store'
import { geminiCredentials } from './providers/registry'

const WEBSITE_RESYNC_AFTER_MS = 24 * 60 * 60 * 1000
/** Sheets are cheap to read and are edited far more often than a
 *  website. The sweep itself only runs hourly, so this effectively means
 *  "every pass". */
const SHEET_RESYNC_AFTER_MS = 55 * 60 * 1000
/** A connected Data Store table, same clock as a sheet: it is a live
 *  source in the same way, and re-reading it costs one local query. */
const TABLE_RESYNC_AFTER_MS = 55 * 60 * 1000
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
      OR: [
        {
          kind: 'website',
          ai_config: { auto_sync_website: true },
          // A linked PDF is excluded from the scheduled re-sync, and
          // only from the scheduled one — Re-sync now still works on it.
          //
          // Two reasons, both about a scan. Reading one costs a real
          // Gemini call over every page, and doing that nightly to a
          // government Act that was last amended in 1969 is money spent
          // on nothing. And OCR is a reading rather than a copy, so two
          // runs can differ in a character or two — which would mark the
          // entry changed, send it back to Not trained and re-embed the
          // whole thing, every single night.
          NOT: { source_url: { endsWith: '.pdf', mode: 'insensitive' } },
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
        {
          // A Data Store table connected as knowledge. These were being
          // re-read only when somebody clicked Re-sync, so a table
          // edited in the CRM kept answering from whatever it held on
          // the day it was connected. The account sees the new row in
          // the Data Store and the assistant quotes the old one, with
          // nothing anywhere explaining the difference.
          kind: 'database',
          OR: [
            { last_synced_at: null },
            { last_synced_at: { lt: new Date(Date.now() - TABLE_RESYNC_AFTER_MS) } },
          ],
        },
      ],
    },
    orderBy: { last_synced_at: { sort: 'asc', nulls: 'first' } },
    take: MAX_PER_PASS,
    select: {
      id: true,
      kind: true,
      source_url: true,
      source_ref: true,
      account_id: true,
      ai_config_id: true,
      content: true,
      description: true,
    },
  })

  result.checked = due.length

  for (const item of due) {
    try {
      let fresh: string
      if (item.kind === 'database') {
        if (!item.source_ref) continue
        // Re-serialised with whatever purpose the entry carries now, so
        // editing the purpose and waiting is the same as re-syncing.
        fresh = (await serializeDataTable(item.account_id, item.source_ref, item.description)).text
      } else if (item.kind === 'sheet') {
        if (!item.source_url) continue
        fresh = serializeSheet(await fetchSheet(item.source_url), item.description)
      } else {
        if (!item.source_url) continue
        const aiRow = await prisma.aiConfig.findUnique({
          where: { id: item.ai_config_id },
          select: { provider_keys: true },
        })
        const gemini = aiRow ? geminiCredentials(aiRow) : { apiKey: null, model: null }
        fresh = (
          await fetchPageText(item.source_url, {
            geminiApiKey: gemini.apiKey,
            model: gemini.model,
            accountId: item.account_id,
          })
        ).text
      }

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
      // Content actually changed, so the copy the reply path is holding
      // is now wrong rather than merely old.
      invalidateKnowledge(item.ai_config_id)
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
