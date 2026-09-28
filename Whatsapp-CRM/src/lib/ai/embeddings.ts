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

/**
 * The models an account can search by meaning with. gemini-embedding-2
 * (GA April 2026) is offered, not imposed: its vectors cannot be compared
 * with the old model's, so switching re-embeds the whole knowledge base,
 * and whether it answers a given business better is for its accuracy
 * tests to say — run them, switch, run them again, keep the better.
 * Checked against ai.google.dev/gemini-api/docs/embeddings, Sept 2026:
 * both default to 3072 dimensions (this table's column); the new model
 * takes no task_type — the task goes in the text instead.
 */
export const EMBEDDING_MODELS = ['gemini-embedding-001', 'gemini-embedding-2'] as const
export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number]

export function isEmbeddingModel(value: unknown): value is EmbeddingModel {
  return typeof value === 'string' && (EMBEDDING_MODELS as readonly string[]).includes(value)
}

const MODEL_TTL_MS = 30_000
const modelCache = new Map<string, { at: number; value: EmbeddingModel }>()

/**
 * The model this AI config searches with. Kept in ai_configs.embedding_model
 * (migration 117) and read with plain SQL on purpose: the column is not in
 * the Prisma model, so a server whose database lacks it still loads every
 * config — and simply uses the original model.
 */
export async function embeddingModelFor(aiConfigId: string): Promise<EmbeddingModel> {
  const hit = modelCache.get(aiConfigId)
  if (hit && Date.now() - hit.at < MODEL_TTL_MS) return hit.value
  let value: EmbeddingModel = EMBEDDING_MODEL
  try {
    const rows = await prisma.$queryRaw<Array<{ embedding_model: string | null }>>(
      Prisma.sql`SELECT embedding_model FROM ai_configs WHERE id = ${aiConfigId}::uuid`,
    )
    if (isEmbeddingModel(rows[0]?.embedding_model)) value = rows[0].embedding_model as EmbeddingModel
  } catch {
    // No column yet: the original model.
  }
  modelCache.set(aiConfigId, { at: Date.now(), value })
  return value
}

export async function setEmbeddingModel(aiConfigId: string, model: EmbeddingModel): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embedding_model TEXT')
  await prisma.$executeRaw(Prisma.sql`UPDATE ai_configs SET embedding_model = ${model} WHERE id = ${aiConfigId}::uuid`)
  modelCache.delete(aiConfigId)
  invalidateHasEmbeddings(aiConfigId)
}

/** What is sent to the embedding API for one text. The new model is told
 *  the task in the text itself, in Google's documented format. */
export function embeddingRequest(
  text: string,
  kind: 'query' | 'document',
  model: EmbeddingModel,
): { text: string; taskType?: TaskType } {
  if (model === 'gemini-embedding-2') {
    return { text: kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}` }
  }
  return { text, taskType: kind === 'query' ? TaskType.RETRIEVAL_QUERY : TaskType.RETRIEVAL_DOCUMENT }
}

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

async function embed(apiKey: string, text: string, kind: 'query' | 'document', modelName: EmbeddingModel): Promise<number[]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: modelName }, { timeout: EMBED_TIMEOUT_MS })
  const request = embeddingRequest(text, kind, modelName)
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: request.text }] },
    ...(request.taskType ? { taskType: request.taskType } : {}),
  })
  return result.embedding.values
}

/** Embeds the customer's incoming message — RETRIEVAL_QUERY biases the
 *  model toward "this is a question, find matching documents", the
 *  asymmetric counterpart to embedDocument below. Using the same task
 *  type for both sides (the naive approach) measurably hurts retrieval
 *  quality for real RAG systems. */
export function embedQuery(apiKey: string, text: string, model: EmbeddingModel = EMBEDDING_MODEL): Promise<number[]> {
  return embed(apiKey, text, 'query', model)
}

/** Embeds one knowledge item (a Q&A pair or document chunk) for storage —
 *  RETRIEVAL_DOCUMENT is the matching other half of the asymmetric pair. */
export function embedDocument(apiKey: string, text: string, model: EmbeddingModel = EMBEDDING_MODEL): Promise<number[]> {
  return embed(apiKey, text, 'document', model)
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
/**
 * Answered from memory for a few minutes at a time.
 *
 * This question sits directly between a customer's message and their
 * reply, it is asked on every single message, and the honest answer
 * changes roughly never — an account that has synced embeddings has them
 * on the next message too. A database round trip to re-establish that
 * bought nothing and cost every reply.
 *
 * The cache is deliberately one-directional in the risk it takes: a
 * false→true flip (somebody just trained the knowledge base for the
 * first time) is pushed straight through by `syncKnowledgeEmbeddings`
 * below, so the improvement is never delayed. Only a true→false flip —
 * which means somebody deleted every embedding they had — waits out the
 * TTL, and for those few minutes retrieval simply finds nothing and
 * falls back to keyword search, which is what it would do anyway.
 */
const HAS_EMBEDDINGS_TTL_MS = 5 * 60_000
const hasEmbeddingsCache = new Map<string, { value: boolean; at: number }>()

/** Called whenever this app's own code changes what is stored, so a
 *  freshly-trained account does not wait out the TTL. */
export function invalidateHasEmbeddings(aiConfigId: string): void {
  hasEmbeddingsCache.delete(aiConfigId)
}

export async function hasEmbeddings(aiConfigId: string): Promise<boolean> {
  const cached = hasEmbeddingsCache.get(aiConfigId)
  if (cached && Date.now() - cached.at < HAS_EMBEDDINGS_TTL_MS) return cached.value

  const model = await embeddingModelFor(aiConfigId)
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(
      SELECT 1 FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${aiConfigId}::uuid AND embedding_model = ${model}
    ) AS exists`,
  )
  const value = rows[0]?.exists ?? false
  hasEmbeddingsCache.set(aiConfigId, { value, at: Date.now() })
  return value
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
  const model = await embeddingModelFor(args.aiConfigId)
  const rows = await prisma.$queryRaw<Array<{ content_hash: string; kind: string; similarity: number }>>(
    Prisma.sql`
      SELECT content_hash, kind, 1 - (embedding <=> ${literal}::vector) AS similarity
      FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${args.aiConfigId}::uuid AND embedding_model = ${model}
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
  // Rows of the other model are left alone: switching back reuses them.
  const model = await embeddingModelFor(aiConfigId)
  let estimatedTokens = 0
  const currentHashes = new Set(items.map((i) => i.contentHash))

  const existing = await prisma.$queryRaw<Array<{ content_hash: string }>>(
    Prisma.sql`
      SELECT content_hash FROM ai_knowledge_embeddings
      WHERE ai_config_id = ${aiConfigId}::uuid AND embedding_model = ${model}
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
          AND embedding_model = ${model}
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
      const vector = await embedDocument(apiKey, item.text, model)
      estimatedTokens += estimateTokensFromText(item.text)
      embedded += await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO ai_knowledge_embeddings (id, ai_config_id, content_hash, kind, embedding_model, embedding)
          VALUES (${randomUUID()}::uuid, ${aiConfigId}::uuid, ${item.contentHash}, ${item.kind}, ${model}, ${vectorLiteral(vector)}::vector)
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
      model,
      feature: 'embedding',
      // Estimated, not vendor-reported — embedContent returns no usage
      // metadata at all. See estimateTokensFromText.
      tokens: { inputTokens: estimatedTokens, outputTokens: 0, totalTokens: estimatedTokens },
      status: failed > 0 ? 'error' : 'success',
      error: failed > 0 ? `${failed} of ${items.length} entries failed to embed` : undefined,
      latencyMs: Date.now() - startedAt,
    })
  }

  // Whatever just happened, the cached answer to "does this account have
  // embeddings" may no longer be true. Cheaper to drop it than to reason
  // about which of the four counts above could have changed it.
  invalidateHasEmbeddings(aiConfigId)

  return { embedded, deleted, failed, firstError }
}

// Re-exported so callers building a KnowledgeDocument-derived item list
// don't need a second import for the type.
export type { KnowledgeDocument }
