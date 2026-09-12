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

export async function loadKnowledge(aiConfigId: string): Promise<LoadedKnowledge> {
  const items = await prisma.aiKnowledgeItem.findMany({
    where: { ai_config_id: aiConfigId, status: { in: USABLE_STATUSES } },
    select: {
      id: true,
      kind: true,
      name: true,
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
      documents.push({ id: item.id, title: item.name, content: item.content })
    }
  }

  return { qaPairs, documents, version: `${items.length}:${newest}` }
}
