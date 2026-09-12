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
  const items = await prisma.aiKnowledgeItem.findMany({
    where: {
      ai_config_id: aiConfigId,
      status: { in: USABLE_STATUSES },
      // Defaulting the parameter to 'customer' is deliberate: a future
      // call site that forgets to pass an audience gets the safe,
      // restrictive behavior rather than accidentally widening it.
      ...(audience === 'customer' ? { audience: { in: CUSTOMER_VISIBLE } } : {}),
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
    },
    orderBy: { created_at: 'asc' },
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
  return { qaPairs, documents, version: `${audience}:${items.length}:${newest}` }
}
