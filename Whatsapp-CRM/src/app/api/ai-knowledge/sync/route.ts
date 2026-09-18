import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { syncKnowledgeEmbeddings, toKnowledgeItems } from '@/lib/ai/embeddings'
import { chunkDocument } from '@/lib/ai/knowledge'
import { loadKnowledge, invalidateKnowledge } from '@/lib/ai/knowledge-store'

/**
 * "Train" — brings the account's embeddings in line with its current
 * knowledge base, then marks the entries that are actually represented
 * in it as 'trained'.
 *
 * Status is written from what the sync really did, not optimistically:
 * an entry only becomes 'trained' after this run has embedded (or
 * confirmed an existing embedding for) its text. That's why the Training
 * tab's Status column means something.
 */
export async function POST() {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  if (!config) {
    return NextResponse.json({ error: 'Connect an AI provider first.' }, { status: 400 })
  }

  const geminiEntry = getProviderKeys(config).gemini
  if (!geminiEntry?.api_key) {
    return NextResponse.json(
      {
        error:
          'Semantic training needs a Google Gemini key — embeddings are Gemini-only. Without one the bot still answers using keyword matching over this same knowledge base.',
      },
      { status: 400 },
    )
  }

  // Everything is embedded, including internal-only entries — the
  // audience boundary is applied at retrieval time, so Admin search
  // can still find staff-only material by meaning.
  const { qaPairs, documents } = await loadKnowledge(config.id, 'all')
  const chunks = documents.flatMap((doc) => chunkDocument(doc))
  const items = toKnowledgeItems(qaPairs, chunks)

  if (items.length === 0) {
    // Nothing to embed — still clear out any stale vectors, so a
    // knowledge base emptied to zero doesn't keep answering from
    // entries that no longer exist.
    const result = await syncKnowledgeEmbeddings({
      aiConfigId: config.id,
      apiKey: decrypt(geminiEntry.api_key),
      items: [],
    })
    return NextResponse.json({ ...result, trained: 0, message: 'Knowledge base is empty.' })
  }

  const result = await syncKnowledgeEmbeddings({
    aiConfigId: config.id,
    apiKey: decrypt(geminiEntry.api_key),
    items,
    accountId,
  })

  // Only claim 'trained' when the run didn't report failures. A partial
  // run leaves the untouched entries 'pending' rather than marking
  // everything green and hiding that something didn't embed.
  let trained = 0
  if (result.failed === 0) {
    const updated = await prisma.aiKnowledgeItem.updateMany({
      where: { ai_config_id: config.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'trained', last_error: null },
    })
    trained = updated.count
  }

  invalidateKnowledge(config.id)

  return NextResponse.json({ ...result, trained })
}
