/**
 * Gemini-based embeddings for semantic knowledge retrieval.
 *
 * Deliberately Gemini-only (not multi-provider like the chat-reply
 * side) — pgvector needs one fixed vector dimension per column, and
 * different providers' embedding models aren't dimension-compatible
 * (OpenAI's text-embedding-3-small is 1536-dim, Gemini's is 3072-dim,
 * etc.), so mixing providers isn't a config choice here the way
 * active_provider/fallback_provider is for chat. Gemini was chosen
 * specifically for Malayalam/Indic-language quality, which is what
 * this app's actual customer base needs.
 *
 * Reuses the account's own stored Gemini key (provider_keys.gemini) —
 * same BYO-key model as chat replies, nothing new to configure. An
 * account with no Gemini key simply never gets embeddings synced;
 * src/lib/ai/knowledge.ts falls back to keyword-overlap search for
 * those accounts, unchanged from before this feature existed.
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { recordAiUsage, estimateTokensFromText } from './usage'
import type { QaPair, KnowledgeDocument } from './knowledge'

/** GA/stable — deliberately not gemini-embedding-2-preview, whose name
 *  and behavior can still change before it leaves preview. Verified
 *  against ai.google.dev/gemini-api/docs/models, Sept 2026. Its
 *  documented default output is 3072 dimensions, matching the
 *  ai_knowledge_embeddings.embedding column (migration 064). Changing
 *  this constant later means every existing row becomes a cache miss
 *  (different embedding_model) and gets regenerated, not silently
 *  compared against vectors from the old model. */
export const EMBEDDING_MODEL = 'gemini-embedding-001'

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The exact text embedded for a Q&A pair — both syncKnowledgeEmbeddings
 *  (write path) and knowledge.ts (read path) must use this same
 *  function, or hashes/text drift out of sync and nothing ever matches. */
export function qaPairEmbeddingText(pair: QaPair): string {
  return `${pair.question}\n${pair.answer}`
}
export function qaPairContentHash(pair: QaPair): string {
  return hashText(qaPairEmbeddingText(pair))
}

/** Same pairing for a document chunk (title kept in the embedded text —
 *  it's often the strongest topical signal a short chunk has). */
export function chunkEmbeddingText(chunk: { title: string; text: string }): string {
  return `${chunk.title}\n${chunk.text}`
}
export function chunkContentHash(chunk: { title: string; text: string }): string {
  return hashText(chunkEmbeddingText(chunk))
}

// Shorter than the chat-reply timeout (providers/types.ts) — a slow
// embedding call has an existing, fast graceful fallback (keyword search,
// see knowledge.ts's selectBySemantic try/catch) that a slow chat-reply
// call doesn't, so there's no reason to make the customer wait as long
// before taking it. Previously had no timeout at all — a hung embedding
// call could add its full hang time on top of the actual reply call.
const EMBED_TIMEOUT_MS = 10_000

async function embed(apiKey: string, text: string, taskType: TaskType): Promise<number[]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL }, { timeout: EMBED_TIMEOUT_MS })
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    taskType,
  })
  return result.embedding.values
}

/** Embeds the customer's incoming message — RETRIEVAL_QUERY biases the
 *  model toward "this is a question, find matching documents", the
 *  asymmetric counterpart to embedDocument below. Using the same task
 *  type for both sides (the naive approach) measurably hurts retrieval
 *  quality for real RAG systems. */
export function embedQuery(apiKey: string, text: string): Promise<number[]> {
  return embed(apiKey, text, TaskType.RETRIEVAL_QUERY)
}

/** Embeds one knowledge item (a Q&A pair or document chunk) for storage —
 *  RETRIEVAL_DOCUMENT is the matching other half of the asymmetric pair. */
export function embedDocument(apiKey: string, text: string): Promise<number[]> {
  return embed(apiKey, text, TaskType.RETRIEVAL_DOCUMENT)
}

/** pgvector's text input format: "[0.1,0.2,...]". Passed as a plain
 *  string parameter and cast with ::vector in SQL — Prisma has no
 *  native vector type (see the model's Unsupported() field), so every
 *  read/write of the vector column goes through this. */
function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

export interface KnowledgeItem {
  contentHash: string
  kind: 'qa' | 'chunk'
  text: string
}

/** Builds the flat item list syncKnowledgeEmbeddings/hasEmbeddings expect,
 *  from an account's raw training_data/knowledge_documents — the one
 *  place both the API route (sync) and knowledge.ts (lookup-by-hash)
 *  derive it from, so they can never disagree about what a "qa"/"chunk"
 *  item's hash or text actually is. */
export function toKnowledgeItems(qaPairs: QaPair[], documentChunks: Array<{ title: string; text: string }>): KnowledgeItem[] {
  const items: KnowledgeItem[] = []
  for (const p of qaPairs) {
    if (!p.question || !p.answer) continue
    items.push({ contentHash: qaPairContentHash(p), kind: 'qa', text: qaPairEmbeddingText(p) })
  }
  for (const c of documentChunks) {
    items.push({ contentHash: chunkContentHash(c), kind: 'chunk', text: chunkEmbeddingText(c) })
  }
  return items
}

/** True iff this account has ever synced at least one embedding —
 *  distinguishes "never synced, use keyword search" from "synced but
 *  nothing scored high enough for this particular message" in
 *  knowledge.ts, which must NOT be treated the same way (the second
 *  case is a legitimate low-confidence signal, not a reason to fall
 *  back to a less accurate search method). */
export async function hasEmbeddings(aiConfigId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(
      SELECT 1 FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${aiConfigId}::uuid AND embedding_model = ${EMBEDDING_MODEL}
    ) AS exists`,
  )
  return rows[0]?.exists ?? false
}

export interface EmbeddingMatch {
  contentHash: string
  kind: 'qa' | 'chunk'
  /** 1 - cosine distance, so 1.0 = identical, 0 = orthogonal, negative =
   *  opposite. Directly usable as a confidence score. */
  similarity: number
}

/** Nearest-neighbor lookup, filtered to one account's rows first (see
 *  the model's schema comment for why no ivfflat/hnsw index is needed
 *  at this scale). */
export async function findSimilarKnowledge(args: {
  aiConfigId: string
  queryVector: number[]
  limit: number
}): Promise<EmbeddingMatch[]> {
  const literal = vectorLiteral(args.queryVector)
  const rows = await prisma.$queryRaw<Array<{ content_hash: string; kind: string; similarity: number }>>(
    Prisma.sql`
      SELECT content_hash, kind, 1 - (embedding <=> ${literal}::vector) AS similarity
      FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${args.aiConfigId}::uuid AND embedding_model = ${EMBEDDING_MODEL}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${args.limit}
    `,
  )
  return rows.map((r) => ({ contentHash: r.content_hash, kind: r.kind as 'qa' | 'chunk', similarity: r.similarity }))
}

/**
 * Keeps ai_knowledge_embeddings in sync with the account's current
 * knowledge base: embeds anything new, deletes anything no longer
 * present (an edited or removed Q&A pair changes its hash, orphaning
 * the old row). Called from PUT /api/ai-config right after the account
 * saves training_data/knowledge_documents — deliberately at save time,
 * not at reply time, so a WhatsApp reply never pays embedding-generation
 * latency; only the "Save" click in Settings does.
 *
 * Embeds items one at a time rather than batching — this app's
 * knowledge bases are explicitly "small-to-medium" (same framing as
 * knowledge.ts's own keyword-scorer comment), and a failed item should
 * not block the others from saving. A single bad/oversized entry logs
 * and is skipped, not a hard failure of the whole sync.
 */
export async function syncKnowledgeEmbeddings(args: {
  aiConfigId: string
  apiKey: string
  items: KnowledgeItem[]
  /** Optional so existing callers keep working; when given, the run is
   *  recorded in the Usage tab. Training can be the largest single
   *  consumer of an account's Gemini quota, so a Usage tab that ignored
   *  it would understate the bill it is there to explain. */
  accountId?: string
}): Promise<{ embedded: number; deleted: number; failed: number; firstError?: string }> {
  const { aiConfigId, apiKey, items, accountId } = args
  const startedAt = Date.now()
  let estimatedTokens = 0
  const currentHashes = new Set(items.map((i) => i.contentHash))

  const existing = await prisma.$queryRaw<Array<{ content_hash: string }>>(
    Prisma.sql`
      SELECT content_hash FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${aiConfigId}::uuid AND embedding_model = ${EMBEDDING_MODEL}
    `,
  )
  const existingHashes = new Set(existing.map((r) => r.content_hash))

  const staleHashes = [...existingHashes].filter((h) => !currentHashes.has(h))
  let deleted = 0
  if (staleHashes.length > 0) {
    deleted = await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM ai_knowledge_embeddings
        WHERE ai_config_id = ${aiConfigId}::uuid
          AND embedding_model = ${EMBEDDING_MODEL}
          AND content_hash IN (${Prisma.join(staleHashes)})
      `,
    )
  }

  const missing = items.filter((i) => !existingHashes.has(i.contentHash))
  let embedded = 0
  let failed = 0
  // Kept so the screen can say why. A count on its own tells somebody
  // that training failed and nothing they can act on; the reason was
  // going only to console.error, where the person who needs it is not
  // looking.
  let firstError: string | undefined
  for (const item of missing) {
    try {
      const vector = await embedDocument(apiKey, item.text)
      estimatedTokens += estimateTokensFromText(item.text)
      embedded += await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO ai_knowledge_embeddings (id, ai_config_id, content_hash, kind, embedding_model, embedding)
          VALUES (${randomUUID()}::uuid, ${aiConfigId}::uuid, ${item.contentHash}, ${item.kind}, ${EMBEDDING_MODEL}, ${vectorLiteral(vector)}::vector)
          ON CONFLICT (ai_config_id, content_hash, embedding_model) DO NOTHING
        `,
      )
    } catch (err) {
      failed++
      firstError ??= err instanceof Error ? err.message : String(err)
      console.error(
        '[embeddings] failed to embed knowledge item:',
        item.kind,
        item.contentHash.slice(0, 8),
        err instanceof Error ? err.message : err,
      )
    }
  }

  if (accountId && embedded > 0) {
    void recordAiUsage({
      accountId,
      model: EMBEDDING_MODEL,
      feature: 'embedding',
      // Estimated, not vendor-reported — embedContent returns no usage
      // metadata at all. See estimateTokensFromText.
      tokens: { inputTokens: estimatedTokens, outputTokens: 0, totalTokens: estimatedTokens },
      status: failed > 0 ? 'error' : 'success',
      error: failed > 0 ? `${failed} of ${items.length} entries failed to embed` : undefined,
      latencyMs: Date.now() - startedAt,
    })
  }

  return { embedded, deleted, failed, firstError }
}

// Re-exported so callers building a KnowledgeDocument-derived item list
// don't need a second import for the type.
export type { KnowledgeDocument }
