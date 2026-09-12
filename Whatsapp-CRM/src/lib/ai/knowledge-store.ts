/**
 * Reads an account's knowledge base out of ai_knowledge_items (real rows
 * since migration 068) and hands it back in exactly the shapes the
 * retrieval and embedding layers already speak — QaPair[] and
 * KnowledgeDocument[].
 *
 * That shape-preserving seam is the whole point of this file: chunking,
 * content hashing and every already-synced embedding row stay byte-for-
 * byte valid across the move from the old JSON columns to rows, because
 * the text being chunked and hashed is unchanged. Nothing needs
 * re-embedding just because the storage moved.
 */

import { prisma } from '@/lib/db'
import type { QaPair, KnowledgeDocument } from './knowledge'

export interface LoadedKnowledge {
  qaPairs: QaPair[]
  documents: KnowledgeDocument[]
  /** Changes whenever any item in this account's knowledge base changes —
   *  safe to use as knowledge.ts's chunk/tokenize cacheKey, which must
   *  not go stale across an edit. Derived from the row count plus the
   *  newest updated_at rather than the AiConfig's own mtime, since
   *  knowledge now changes without the config row being touched. */
  version: string
}

/** Statuses whose content is still usable at reply time. 'disabled' is
 *  the explicit "keep it but don't use it" state. 'failed' entries are
 *  included when they still hold content — a website re-sync that failed
 *  today shouldn't silently drop the copy that synced fine yesterday. */
const USABLE_STATUSES = ['trained', 'pending', 'failed']

/**
 * Who the loaded knowledge is allowed to reach.
 *
 *  - 'customer' is the boundary that makes the Customer/Admin split
 *    real: it returns only entries marked customer-safe (or 'both'), so
 *    an 'internal' entry never enters a customer-facing prompt at all.
 *    Being absent from the prompt is what makes it unquotable — a
 *    system-prompt instruction not to reveal something is guidance the
 *    model can be talked out of, whereas text it was never given cannot
 *    be leaked.
 *  - 'all' is for the Admin side (Admin Test's knowledge search), where
 *    staff-only material is exactly what's being looked for.
 */
export type KnowledgeAudience = 'customer' | 'all'

const CUSTOMER_VISIBLE = ['customer', 'both']

export async function loadKnowledge(
  aiConfigId: string,
  audience: KnowledgeAudience = 'customer',
): Promise<LoadedKnowledge> {
  // Entries are filtered by their validity window at load time, not
  // ranked down afterwards.
  //
  // This matters more than it looks. Last term's fee list and this
  // term's are equally retrievable without it, and the model answers
  // with whichever happens to embed closer to the question — producing
  // an answer that is fluent, specific and confidently out of date,
  // which is the most damaging kind of wrong. Excluding the expired row
  // from the query means it cannot be quoted at all, the same reasoning
  // that makes the audience filter a real boundary rather than advice.
  //
  // Both bounds are null for the overwhelming majority of entries, and a
  // null bound means "no limit that way".
  const now = new Date()
  const withinValidityWindow = {
    AND: [
      { OR: [{ effective_from: null }, { effective_from: { lte: now } }] },
      { OR: [{ effective_until: null }, { effective_until: { gte: now } }] },
    ],
  }

  const items = await prisma.aiKnowledgeItem.findMany({
    where: {
      ai_config_id: aiConfigId,
      status: { in: USABLE_STATUSES },
      // Defaulting the parameter to 'customer' is deliberate: a future
      // call site that forgets to pass an audience gets the safe,
      // restrictive behavior rather than accidentally widening it.
      ...(audience === 'customer' ? { audience: { in: CUSTOMER_VISIBLE } } : {}),
      ...withinValidityWindow,
    },
    select: {
      id: true,
      kind: true,
      name: true,
      description: true,
      question: true,
      answer: true,
      content: true,
      updated_at: true,
      department: true,
      priority: true,
    },
    // Priority first, so an entry marked important wins a tie against
    // one that merely embeds slightly closer. created_at breaks the
    // remaining ties, keeping chunk order stable across loads — which
    // the content-hash cache depends on.
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
  })

  const qaPairs: QaPair[] = []
  const documents: KnowledgeDocument[] = []
  let newest = 0

  for (const item of items) {
    newest = Math.max(newest, item.updated_at.getTime())
    if (item.kind === 'qa') {
      if (item.question && item.answer) qaPairs.push({ question: item.question, answer: item.answer })
    } else if (item.content?.trim()) {
      // The account's own "what this is for" note becomes the first
      // line of the document, so every chunk cut from it inherits that
      // context in its title. A fee table retrieved as a bare fragment
      // is exactly where models misread data.
      documents.push({
        id: item.id,
        title: item.description?.trim() ? `${item.name} — ${item.description.trim()}` : item.name,
        content: item.content,
      })
    }
  }

  // Audience is part of the version: the customer and admin scopes
  // return different sets, and a shared cache key would let one be
  // served the other's chunked form.
  //
  // The hour is part of it too, because of the validity windows above.
  // Count-plus-newest-mtime does not change when one entry expires at
  // the same moment another becomes effective — the cache would then
  // keep serving chunks built from an entry that is no longer valid,
  // which is exactly the stale-fee-list failure the windows exist to
  // prevent. Hour granularity bounds that to an hour and costs one
  // rebuild per hour on an unchanged knowledge base; windows are set to
  // a date in practice, never to a minute.
  const hourBucket = Math.floor(Date.now() / 3_600_000)
  return { qaPairs, documents, version: `${audience}:${items.length}:${newest}:${hourBucket}` }
}
