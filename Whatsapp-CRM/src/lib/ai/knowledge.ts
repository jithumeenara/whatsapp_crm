/**
 * Picks which Q&A pairs and reference-document chunks are actually
 * relevant to the current message, instead of stuffing the entire
 * knowledge base into every prompt (the old behavior — wastes tokens and
 * dilutes accuracy once an account has more than a handful of entries).
 *
 * Two retrieval paths, chosen automatically per call:
 *   - Semantic (embeddings/pgvector, src/lib/ai/embeddings.ts) — used
 *     whenever the account has synced at least one embedding. Finds
 *     matches by meaning, not shared words: "what's the cost" now finds
 *     a knowledge entry that only says "pricing details", which plain
 *     keyword overlap never could.
 *   - Keyword overlap (this file's original implementation) — the
 *     fallback whenever semantic search hasn't been set up for this
 *     account (no Gemini key saved, or the knowledge base was never
 *     synced) or a live embedding call fails. Never a hard dependency —
 *     an account that does nothing differently gets identical behavior
 *     to before this feature existed.
 *
 * `selectRelevantContext` is the one seam both paths go through, and now
 * also returns a `confidence` score (0-1) — the flows engine's ai_reply
 * node compares this against AiConfig.confidence_threshold to decide
 * "answer" vs "hand off to a human instead of guessing".
 */

import {
  hasEmbeddings,
  embedQuery,
  findSimilarKnowledge,
  qaPairContentHash,
  chunkContentHash,
} from './embeddings'

export interface QaPair {
  question: string
  answer: string
}

export interface KnowledgeDocument {
  id: string
  title: string
  content: string
  created_at?: string
}

export interface SelectedContext {
  qaPairs: QaPair[]
  documentChunks: Array<{ title: string; text: string }>
  /** Top retrieval score found, normalized to roughly 0-1. Semantic
   *  matches use real cosine similarity; keyword matches use the
   *  fraction of the customer's own words that were actually found in
   *  the matched entry — not literally comparable across the two
   *  methods, but both serve the same purpose for the caller: "how much
   *  of what was asked did we actually find?" 0 when nothing matched. */
  confidence: number
}

interface SelectOptions {
  maxQaPairs?: number
  maxDocChunks?: number
  /** Chunks/pairs scoring at or below this are dropped entirely, even if
   *  it means returning fewer than max — an irrelevant match is worse
   *  than no match, since the caller's fallback_answer guardrail only
   *  makes sense when nothing relevant was actually found. Keyword path
   *  only — semantic search has its own notion of "nothing relevant"
   *  via the confidence score instead. */
  minScore?: number
  /** Opt into the chunk/tokenize cache — pass something that changes
   *  whenever qaPairs/documents actually do, e.g. `${aiConfig.id}:${aiConfig.updated_at.getTime()}`.
   *  Omit to always recompute (safe default when the caller can't cheaply
   *  prove the knowledge base hasn't changed since the last call). */
  cacheKey?: string
  /** Opt into semantic retrieval for this account. Omit entirely (e.g.
   *  no Gemini key saved) to always use keyword search — same as before
   *  this feature existed. */
  semantic?: { aiConfigId: string; geminiApiKey: string }
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'as', 'by', 'and',
  'or', 'but', 'if', 'so', 'not', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that',
  'what', 'when', 'where', 'why', 'how', 'me', 'have', 'has', 'had',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

function overlapScore(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0
  const targetSet = new Set(targetTokens)
  let hits = 0
  for (const t of queryTokens) if (targetSet.has(t)) hits++
  return hits
}

/**
 * Chunking + tokenizing the whole knowledge base is the expensive part of
 * this file — re-splitting every document into paragraphs and re-running
 * the tokenizer over every chunk/Q&A pair, on every single ai_reply call,
 * even though the underlying AiConfig row (training_data/knowledge_documents)
 * rarely changes between messages in the same conversation, let alone
 * between messages across an account's whole inbox. This module-level cache
 * memoizes the chunked+tokenized form per AiConfig version (see cacheKey
 * below) so a burst of messages against an unchanged knowledge base pays
 * the tokenizing cost once, not once per message. Reused by both
 * retrieval paths — semantic search still needs the chunked (not raw
 * document) form to hash/match against what was actually embedded.
 *
 * Deliberately process-local (a plain Map), not Redis/a DB table — this is
 * a hot-path micro-optimization, not state that needs to survive a
 * restart or be shared across instances; the worst case of a cold cache
 * (a fresh deploy, or an account not seen in a while getting evicted) is
 * just paying the original per-call cost once more.
 */
interface CachedKnowledge {
  chunks: Array<{ title: string; text: string; tokens: string[] }>
  pairs: Array<{ pair: QaPair; tokens: string[] }>
}
const KNOWLEDGE_CACHE_MAX_ENTRIES = 500
const knowledgeCache = new Map<string, CachedKnowledge>()

function getOrBuildKnowledge(qaPairs: QaPair[], documents: KnowledgeDocument[], cacheKey?: string): CachedKnowledge {
  if (cacheKey) {
    const cached = knowledgeCache.get(cacheKey)
    if (cached) return cached
  }

  const chunks = documents
    .flatMap((doc) => chunkDocument(doc))
    .map((c) => ({ ...c, tokens: tokenize(c.text) }))
  const pairs = qaPairs
    .filter((p) => p.question && p.answer)
    .map((p) => ({ pair: p, tokens: tokenize(`${p.question} ${p.answer}`) }))

  const built: CachedKnowledge = { chunks, pairs }
  if (cacheKey) {
    // Simple size bound — evict the oldest entry (Map preserves insertion
    // order) rather than growing unbounded across every account this
    // process ever serves an ai_reply for.
    if (knowledgeCache.size >= KNOWLEDGE_CACHE_MAX_ENTRIES) {
      const oldestKey = knowledgeCache.keys().next().value
      if (oldestKey !== undefined) knowledgeCache.delete(oldestKey)
    }
    knowledgeCache.set(cacheKey, built)
  }
  return built
}

/** Splits a document into paragraph-sized chunks (falls back to fixed-size
 *  windows for documents with no blank-line breaks) so a single very long
 *  document doesn't get scored — and, if it matches, injected — as one
 *  indivisible block. Exported so the embedding-sync path (PUT
 *  /api/ai-config, via embeddings.ts) chunks documents identically to
 *  how this file does at retrieval time — a mismatched chunk boundary
 *  would mean the content hash computed at save time never matches the
 *  one computed here, and the embedding would silently never be found. */
export function chunkDocument(doc: KnowledgeDocument, maxChunkChars = 800): Array<{ title: string; text: string }> {
  const paragraphs = doc.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const source = paragraphs.length > 1 ? paragraphs : [doc.content]

  const chunks: string[] = []
  for (const para of source) {
    if (para.length <= maxChunkChars) {
      chunks.push(para)
      continue
    }
    for (let i = 0; i < para.length; i += maxChunkChars) {
      chunks.push(para.slice(i, i + maxChunkChars))
    }
  }
  return chunks.map((text) => ({ title: doc.title, text }))
}

function selectByKeyword(
  queryTokens: string[],
  allPairs: CachedKnowledge['pairs'],
  allChunks: CachedKnowledge['chunks'],
  limits: { maxQaPairs: number; maxDocChunks: number; minScore: number },
): SelectedContext {
  const scoredPairs = allPairs
    .map(({ pair, tokens }) => ({ pair, score: overlapScore(queryTokens, tokens) }))
    .filter((s) => s.score >= limits.minScore)
    .sort((a, b) => b.score - a.score)

  const scoredChunks = allChunks
    .map((c) => ({ chunk: { title: c.title, text: c.text }, score: overlapScore(queryTokens, c.tokens) }))
    .filter((s) => s.score >= limits.minScore)
    .sort((a, b) => b.score - a.score)

  const topScore = Math.max(scoredPairs[0]?.score ?? 0, scoredChunks[0]?.score ?? 0)
  // Fraction of the customer's own words that were found in the best
  // match — an approximation, not a real probability, but comparable in
  // spirit to the semantic path's cosine similarity for the caller's
  // confidence-threshold check.
  const confidence = queryTokens.length > 0 ? Math.min(topScore / queryTokens.length, 1) : 0

  return {
    qaPairs: scoredPairs.slice(0, limits.maxQaPairs).map((s) => s.pair),
    documentChunks: scoredChunks.slice(0, limits.maxDocChunks).map((s) => s.chunk),
    confidence,
  }
}

/** Returns null to signal "fall back to keyword search" — either this
 *  account has never synced an embedding (hasEmbeddings is the gate that
 *  distinguishes that from "synced, but nothing scored well enough",
 *  which must NOT fall back, since that's a legitimate low-confidence
 *  result in its own right) or the live embedding call itself failed. */
async function selectBySemantic(
  userMessage: string,
  allPairs: CachedKnowledge['pairs'],
  allChunks: CachedKnowledge['chunks'],
  semantic: { aiConfigId: string; geminiApiKey: string },
  limits: { maxQaPairs: number; maxDocChunks: number },
): Promise<SelectedContext | null> {
  const synced = await hasEmbeddings(semantic.aiConfigId)
  if (!synced) return null

  try {
    const queryVector = await embedQuery(semantic.geminiApiKey, userMessage)
    const matches = await findSimilarKnowledge({
      aiConfigId: semantic.aiConfigId,
      queryVector,
      limit: limits.maxQaPairs + limits.maxDocChunks,
    })

    const pairsByHash = new Map(allPairs.map((p) => [qaPairContentHash(p.pair), p.pair]))
    const chunksByHash = new Map(allChunks.map((c) => [chunkContentHash(c), { title: c.title, text: c.text }]))

    const qaPairs: QaPair[] = []
    const documentChunks: Array<{ title: string; text: string }> = []
    for (const m of matches) {
      if (m.kind === 'qa') {
        const pair = pairsByHash.get(m.contentHash)
        // A match whose hash isn't in the account's current knowledge
        // base any more (edited/deleted since the last sync) is simply
        // skipped — the next Settings save will clean up the stale
        // embedding row itself (syncKnowledgeEmbeddings' delete step).
        if (pair && qaPairs.length < limits.maxQaPairs) qaPairs.push(pair)
      } else {
        const chunk = chunksByHash.get(m.contentHash)
        if (chunk && documentChunks.length < limits.maxDocChunks) documentChunks.push(chunk)
      }
    }

    const confidence = matches.length > 0 ? Math.max(0, matches[0].similarity) : 0
    return { qaPairs, documentChunks, confidence }
  } catch (err) {
    console.error('[knowledge] semantic retrieval failed, falling back to keyword search:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function selectRelevantContext(
  userMessage: string,
  qaPairs: QaPair[] = [],
  documents: KnowledgeDocument[] = [],
  opts: SelectOptions = {},
): Promise<SelectedContext> {
  const { maxQaPairs = 5, maxDocChunks = 3, minScore = 1, cacheKey, semantic } = opts
  const { chunks: allChunks, pairs: allPairs } = getOrBuildKnowledge(qaPairs, documents, cacheKey)

  if (semantic) {
    const result = await selectBySemantic(userMessage, allPairs, allChunks, semantic, { maxQaPairs, maxDocChunks })
    if (result) return result
  }

  const queryTokens = tokenize(userMessage)
  return selectByKeyword(queryTokens, allPairs, allChunks, { maxQaPairs, maxDocChunks, minScore })
}

/** Builds the plain-text "Knowledge base" block appended to the system
 *  prompt — same framing style the old gemini-only implementation used,
 *  just fed a relevance-filtered subset instead of everything. */
export function formatKnowledgeBlock(context: SelectedContext): string {
  const parts: string[] = []
  if (context.qaPairs.length > 0) {
    parts.push(
      'Knowledge base (use these to answer questions accurately):',
      ...context.qaPairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`),
    )
  }
  if (context.documentChunks.length > 0) {
    parts.push(
      'Reference material:',
      ...context.documentChunks.map((c) => `From "${c.title}":\n${c.text}`),
    )
  }
  return parts.join('\n\n')
}
