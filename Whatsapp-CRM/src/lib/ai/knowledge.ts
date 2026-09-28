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
  embeddingModelFor,
  findSimilarKnowledge,
  qaPairContentHash,
  chunkContentHash,
} from './embeddings'
import { englishFor, normalizeMalayalam, wordStarts } from './term-bridge'

export interface QaPair {
  question: string
  answer: string
  /** The knowledge entry it came from — carried so a reply can say where
   *  its answer came from. Not part of any hash. */
  id?: string
}

export interface KnowledgeDocument {
  id: string
  title: string
  content: string
  created_at?: string
}

export interface SelectedContext {
  qaPairs: QaPair[]
  /** `sourceId` is the knowledge entry the passage was cut from. */
  documentChunks: Array<{ title: string; text: string; sourceId?: string }>
  /** Top retrieval score found, normalized to roughly 0-1. Semantic
   *  matches use real cosine similarity; keyword matches use the
   *  fraction of the customer's own words that were actually found in
   *  the matched entry — not literally comparable across the two
   *  methods, but both serve the same purpose for the caller: "how much
   *  of what was asked did we actually find?" 0 when nothing matched. */
  confidence: number
  /** How many passages each source holds in all, by `sourceId` — so the
   *  prompt can say whether a source was given complete or only in part. */
  sourceTotals?: Record<string, number>
  /** How long the query embedding took, in milliseconds — a provider
   *  round trip that happens between the customer's message and their
   *  reply, and the one part of retrieval that is not this app's own
   *  database. Absent on the keyword path, which makes no such call. */
  embeddingMs?: number
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

/** How many extra candidates to pull from the vector search relative to
 *  how many will be used, so post-ranking filtering (audience scope,
 *  stale hashes) still leaves enough to fill the context. Four is
 *  generous enough to survive a knowledge base that is mostly
 *  staff-only, and small enough that the extra rows cost nothing at
 *  this scale — the query is already filtered to one config. */
const OVERFETCH_FACTOR = 4
/** Absolute ceiling, so a large max_context_results can't turn one reply
 *  into an unbounded scan. */
const MAX_SEMANTIC_CANDIDATES = 100

/** A source this short is given whole once any part of it matches —
 *  roughly 60 table records. */
const WHOLE_SOURCE_MAX_CHARS = 12_000
/** Ceiling on the text added by giving sources whole, per reply. */
const WHOLE_SOURCE_BUDGET_CHARS = 24_000

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'as', 'by', 'and',
  'or', 'but', 'if', 'so', 'not', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that',
  'what', 'when', 'where', 'why', 'how', 'me', 'have', 'has', 'had',
  'please', 'want', 'need', 'any', 'all', 'there', 'which', 'who',
  // Malayalam question and filler words: in nearly every message, so a
  // match on them says nothing about the entry.
  'ആണ്', 'ആണോ', 'ഉണ്ട്', 'ഉണ്ടോ', 'ഉള്ളത്', 'ഉള്ള', 'എന്ത്', 'എന്താണ്', 'ഏത്', 'ഏതാണ്',
  'ഏതൊക്കെ', 'എന്തൊക്കെ', 'എങ്ങനെ', 'എപ്പോൾ', 'എവിടെ', 'ഒരു', 'ഈ', 'ആ', 'ഞാൻ', 'എനിക്ക്',
  'എന്റെ', 'നിങ്ങൾ', 'നിങ്ങളുടെ', 'ഞങ്ങൾ', 'ഞങ്ങളുടെ', 'അത്', 'ഇത്', 'അവിടെ', 'ഇവിടെ',
  'ഒക്കെ', 'മാത്രം', 'കൂടി', 'വേണം', 'പറ്റുമോ', 'പറയാമോ', 'അറിയാൻ', 'പറയൂ', 'ഇല്ല',
  'എന്ന്', 'കുറിച്ച്', 'പറ്റി', 'സാർ', 'മാഡം', 'ദയവായി',
  // …and the same written in English letters.
  'enthokke', 'ethokke', 'entha', 'enthanu', 'ethanu', 'undo', 'undu', 'aanu', 'ano',
  'ulla', 'ullathu', 'enikku', 'ente', 'ningal', 'ningalude', 'evide', 'eppol', 'engane',
  'onnu', 'parayamo', 'venam', 'ariyan', 'sir', 'madam',
])

/**
 * Words in any script, lower-cased.
 *
 * This used to keep only a–z and 0–9, which threw away every Malayalam
 * word: a question written in Malayalam had no words left to match, and
 * whenever the search by meaning was unavailable the assistant answered
 * it with no knowledge at all. Letters, their combining marks (a
 * Malayalam vowel sign is a mark — splitting on it cuts a word into
 * letters) and digits now all count; the zero-width joiners of older
 * Malayalam encodings are dropped so both spellings match.
 */
function tokenize(text: string): string[] {
  return normalizeMalayalam(text)
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => Array.from(t).length > 1 && !STOPWORDS.has(t))
}

/** A shorter word counts as found at the start of a longer one:
 *  "programme" in "programmes", "ട്രെയിനിങ്" in "ട്രെയിനിങ്ങിൽ" —
 *  Malayalam adds its endings to the word itself. Long enough that
 *  "fee" is not found in "feedback". */
const MIN_STEM = { latin: 5, other: 4 }

function stemMatches(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  const min = /^[a-z0-9]+$/.test(short) ? MIN_STEM.latin : MIN_STEM.other
  // "ഡോക്ടർ" is found in "ഡോക്ടറെ": the final chillu becomes a full
  // letter before the ending.
  return Array.from(short).length >= min && wordStarts(short).some((s) => long.startsWith(s))
}

/** Each word of the question with the English words it can stand for
 *  ("ഫീസ്" → fee, fees): the data is often English when the question is
 *  not. A word counts once, whichever of its forms is found. */
function queryTerms(text: string): string[][] {
  return tokenize(text).map((t) => [t, ...englishFor(t)])
}

function overlapScore(queryTerms: string[][], targetTokens: string[]): number {
  if (queryTerms.length === 0 || targetTokens.length === 0) return 0
  const targetSet = new Set(targetTokens)
  let hits = 0
  for (const forms of queryTerms) {
    const found = forms.some((t) => {
      if (targetSet.has(t)) return true
      for (const u of targetSet) if (stemMatches(t, u)) return true
      return false
    })
    if (found) hits++
  }
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
  chunks: Array<{ title: string; text: string; sourceId?: string; tokens: string[] }>
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
export function chunkDocument(doc: KnowledgeDocument, maxChunkChars = 800): Array<{ title: string; text: string; sourceId?: string }> {
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
  // sourceId rides along for attribution only; hashes read title and text.
  return chunks.map((text) => ({ title: doc.title, text, sourceId: doc.id }))
}

/** Every Q&A pair and passage with at least `minScore` of the question's
 *  words, best first. */
function keywordRanked(
  queryTokens: string[][],
  allPairs: CachedKnowledge['pairs'],
  allChunks: CachedKnowledge['chunks'],
  minScore: number,
) {
  const scoredPairs = allPairs
    .map(({ pair, tokens }) => ({ pair, score: overlapScore(queryTokens, tokens) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
  const scoredChunks = allChunks
    .map((c) => ({ chunk: { title: c.title, text: c.text, sourceId: c.sourceId }, score: overlapScore(queryTokens, c.tokens) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
  return { scoredPairs, scoredChunks }
}

/**
 * Reciprocal rank fusion: each list votes 1/(60 + rank) for its items and
 * the totals decide the order. Rank, not score, so a cosine similarity
 * and a word count need no common scale; an item both lists found rises
 * to the top. The standard way to merge a search by meaning with a
 * search by words (it lifted precision from ~62% to ~84% in published
 * field tests), and the reason exact names and codes stop being missed.
 */
export function reciprocalRankFusion<T>(lists: ReadonlyArray<readonly T[]>, keyOf: (item: T) => string, k = 60): T[] {
  const scores = new Map<string, { item: T; score: number; first: number }>()
  let order = 0
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item)
      const entry = scores.get(key)
      if (entry) entry.score += 1 / (k + rank + 1)
      else scores.set(key, { item, score: 1 / (k + rank + 1), first: order++ })
    })
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.first - b.first).map((e) => e.item)
}

function selectByKeyword(
  queryTokens: string[][],
  allPairs: CachedKnowledge['pairs'],
  allChunks: CachedKnowledge['chunks'],
  limits: { maxQaPairs: number; maxDocChunks: number; minScore: number },
): SelectedContext {
  const { scoredPairs, scoredChunks } = keywordRanked(queryTokens, allPairs, allChunks, limits.minScore)

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
    const embedStartedAt = Date.now()
    const queryVector = await embedQuery(semantic.geminiApiKey, userMessage, await embeddingModelFor(semantic.aiConfigId))
    const embeddingMs = Date.now() - embedStartedAt
    // Over-fetch, because a match can be dropped after ranking.
    //
    // The vector search covers every embedding for this AI config, but
    // the caller's knowledge may be a subset of it — most importantly
    // when the customer path loads only customer-safe entries while
    // staff-only ones are still indexed (see knowledge-store's audience
    // filter), and also when an entry was edited or deleted since the
    // last sync so its old hash lingers. Asking for exactly as many
    // matches as we intend to use meant a handful of staff-only entries
    // at the top could push every usable customer entry below the cut,
    // leaving the reply with little or no grounding while relevant
    // material sat just underneath.
    const wanted = limits.maxQaPairs + limits.maxDocChunks
    const matches = await findSimilarKnowledge({
      aiConfigId: semantic.aiConfigId,
      queryVector,
      limit: Math.min(wanted * OVERFETCH_FACTOR, MAX_SEMANTIC_CANDIDATES),
    })

    const pairsByHash = new Map(allPairs.map((p) => [qaPairContentHash(p.pair), p.pair]))
    const chunksByHash = new Map(allChunks.map((c) => [chunkContentHash(c), { title: c.title, text: c.text, sourceId: c.sourceId }]))

    const qaPairs: QaPair[] = []
    const documentChunks: Array<{ title: string; text: string; sourceId?: string }> = []
    // The best score among matches this caller may actually use — not
    // simply the best score returned.
    let usableTopScore = 0

    for (const m of matches) {
      if (m.kind === 'qa') {
        const pair = pairsByHash.get(m.contentHash)
        // A match whose hash isn't in this caller's knowledge is skipped:
        // either it is out of scope for them (a staff-only entry on the
        // customer path) or it is stale (edited/deleted since the last
        // sync, which syncKnowledgeEmbeddings' delete step cleans up).
        if (pair && qaPairs.length < limits.maxQaPairs) {
          qaPairs.push(pair)
          usableTopScore = Math.max(usableTopScore, m.similarity)
        }
      } else {
        const chunk = chunksByHash.get(m.contentHash)
        if (chunk && documentChunks.length < limits.maxDocChunks) {
          documentChunks.push(chunk)
          usableTopScore = Math.max(usableTopScore, m.similarity)
        }
      }
    }

    // Confidence must describe what was actually retrieved. Reading it
    // off matches[0] meant a staff-only entry scoring 0.9 reported 0.9
    // confidence while the returned context was empty — so the
    // low-confidence handoff stayed quiet and the model answered with
    // nothing to answer from. Empty context is now honestly 0.
    const confidence = Math.max(0, usableTopScore)
    return { qaPairs, documentChunks, confidence, embeddingMs }
  } catch (err) {
    console.error('[knowledge] semantic retrieval failed, falling back to keyword search:', err instanceof Error ? err.message : err)
    return null
  }
}

type Chunk = { title: string; text: string; sourceId?: string }

/**
 * Gives a matched source whole when it is short, instead of the few
 * passages that scored best.
 *
 * A Data Store table is one passage per record, and retrieval keeps the
 * handful of records closest to the question. For "which programmes do
 * you have?" that is the wrong cut: the records whose names repeat the
 * question's words win, and a programme named differently ("Gold loan
 * Appraisal…" beside three "Statutory Training Programme"s) is silently
 * left out — the reply then reads as the complete list. Short sources
 * are given in full, in their own order; longer ones keep their matched
 * passages plus a table's header, and the prompt says they are partial.
 *
 * Only which passages are sent changes — chunking and hashes do not, so
 * nothing needs retraining.
 */
export function widenToWholeSources(
  selected: Chunk[],
  allChunks: Chunk[],
): { documentChunks: Chunk[]; sourceTotals: Record<string, number> } {
  const bySource = new Map<string, Chunk[]>()
  for (const c of allChunks) {
    if (!c.sourceId) continue
    const list = bySource.get(c.sourceId)
    if (list) list.push(c)
    else bySource.set(c.sourceId, [c])
  }

  // Sources in the order their best passage ranked.
  const order: string[] = []
  const matched = new Map<string, Chunk[]>()
  const loose: Chunk[] = []
  for (const c of selected) {
    if (!c.sourceId || !bySource.has(c.sourceId)) {
      loose.push(c)
      continue
    }
    const list = matched.get(c.sourceId)
    if (list) list.push(c)
    else {
      matched.set(c.sourceId, [c])
      order.push(c.sourceId)
    }
  }

  const out: Chunk[] = []
  const sourceTotals: Record<string, number> = {}
  let budget = WHOLE_SOURCE_BUDGET_CHARS
  for (const id of order) {
    const all = bySource.get(id)!
    sourceTotals[id] = all.length
    const size = all.reduce((n, c) => n + c.text.length, 0)
    if (size <= WHOLE_SOURCE_MAX_CHARS && size <= budget) {
      budget -= size
      out.push(...all.map((c) => ({ title: c.title, text: c.text, sourceId: c.sourceId })))
      continue
    }
    const picked = matched.get(id)!
    // A table's header says what its records are; keep it with them.
    const head = all[0]
    if (head.text.startsWith('TABLE: ') && !picked.some((c) => c.text === head.text)) {
      out.push({ title: head.title, text: head.text, sourceId: head.sourceId })
    }
    out.push(...picked)
  }
  out.push(...loose)
  return { documentChunks: out, sourceTotals }
}

export async function selectRelevantContext(
  userMessage: string,
  qaPairs: QaPair[] = [],
  documents: KnowledgeDocument[] = [],
  opts: SelectOptions = {},
): Promise<SelectedContext> {
  const { maxQaPairs = 5, maxDocChunks = 3, minScore = 1, cacheKey, semantic } = opts
  const { chunks: allChunks, pairs: allPairs } = getOrBuildKnowledge(qaPairs, documents, cacheKey)

  let result: SelectedContext | null = null
  const queryTokens = queryTerms(userMessage)
  if (semantic) {
    result = await selectBySemantic(userMessage, allPairs, allChunks, semantic, { maxQaPairs, maxDocChunks })
    if (result) {
      // Hybrid: the search by meaning, fused with the strong word matches
      // — at least half the question's words. Meaning finds "what does
      // it cost" in "fee details"; words find "STP (M)" and an invoice
      // number, which meaning blurs. Confidence stays the meaning score,
      // which the hand-over threshold is calibrated on.
      const strong = Math.max(minScore, Math.ceil(queryTokens.length * 0.5))
      const words = keywordRanked(queryTokens, allPairs, allChunks, strong)
      result = {
        ...result,
        qaPairs: reciprocalRankFusion(
          [result.qaPairs, words.scoredPairs.map((s) => s.pair)],
          (p) => `${p.question}\n${p.answer}`,
        ).slice(0, maxQaPairs),
        documentChunks: reciprocalRankFusion(
          [result.documentChunks, words.scoredChunks.map((s) => s.chunk)],
          (c) => `${c.title}\n${c.text}`,
        ).slice(0, maxDocChunks),
      }
    }
  }
  if (!result) {
    result = selectByKeyword(queryTokens, allPairs, allChunks, { maxQaPairs, maxDocChunks, minScore })
  }
  return { ...result, ...widenToWholeSources(result.documentChunks, allChunks) }
}

/** Builds the plain-text "Knowledge base" block appended to the system
 *  prompt — same framing style the old gemini-only implementation used,
 *  just fed a relevance-filtered subset instead of everything. Passages
 *  are grouped by source, each marked complete or partial, so a partial
 *  table is never read as the whole list. */
export function formatKnowledgeBlock(context: SelectedContext): string {
  const parts: string[] = []
  if (context.qaPairs.length > 0) {
    parts.push(
      'Knowledge base (use these to answer questions accurately):',
      ...context.qaPairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`),
    )
  }
  if (context.documentChunks.length > 0) {
    parts.push('Reference material:')
    const groups: Chunk[][] = []
    for (const c of context.documentChunks) {
      const last = groups[groups.length - 1]
      if (last && c.sourceId && last[0].sourceId === c.sourceId) last.push(c)
      else groups.push([c])
    }
    for (const group of groups) {
      const { title, sourceId } = group[0]
      const total = sourceId ? context.sourceTotals?.[sourceId] : undefined
      const note =
        total === undefined
          ? ''
          : group.length >= total
            ? ' (complete — everything in this source is below)'
            : ' (PARTIAL — only the parts that matched this question; it holds more. Do not present this as a complete list.)'
      parts.push(`From "${title}"${note}:\n${group.map((c) => c.text).join('\n\n')}`)
    }
  }
  return parts.join('\n\n')
}
