/**
 * Picks which Q&A pairs and reference-document chunks are actually
 * relevant to the current message, instead of stuffing the entire
 * knowledge base into every prompt (the old behavior — wastes tokens and
 * dilutes accuracy once an account has more than a handful of entries).
 *
 * This is deliberately a plain keyword-overlap scorer, not semantic
 * search — there's no vector database in this stack, and adding one
 * (pgvector + an embeddings pipeline) is a real, separate infrastructure
 * project, not something to bolt on here. Keyword overlap is the same
 * first-pass filtering technique real retrieval-augmented systems use
 * ahead of (or instead of) embeddings for small-to-medium knowledge
 * bases, so this is a genuine, honest step toward "grounded," not a fake
 * one — it's just not the more expensive semantic version.
 *
 * `selectRelevantContext` is exported as the one seam a future embeddings
 * based implementation would replace — every call site here goes through
 * this single function, so upgrading later means changing this file only.
 */

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
}

interface SelectOptions {
  maxQaPairs?: number
  maxDocChunks?: number
  /** Chunks/pairs scoring at or below this are dropped entirely, even if
   *  it means returning fewer than max — an irrelevant match is worse
   *  than no match, since the caller's fallback_answer guardrail only
   *  makes sense when nothing relevant was actually found. */
  minScore?: number
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

/** Splits a document into paragraph-sized chunks (falls back to fixed-size
 *  windows for documents with no blank-line breaks) so a single very long
 *  document doesn't get scored — and, if it matches, injected — as one
 *  indivisible block. */
function chunkDocument(doc: KnowledgeDocument, maxChunkChars = 800): Array<{ title: string; text: string }> {
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

export function selectRelevantContext(
  userMessage: string,
  qaPairs: QaPair[] = [],
  documents: KnowledgeDocument[] = [],
  opts: SelectOptions = {},
): SelectedContext {
  const { maxQaPairs = 5, maxDocChunks = 3, minScore = 1 } = opts
  const queryTokens = tokenize(userMessage)

  const scoredPairs = qaPairs
    .filter((p) => p.question && p.answer)
    .map((p) => ({ pair: p, score: overlapScore(queryTokens, tokenize(`${p.question} ${p.answer}`)) }))
    .filter((s) => s.score > minScore - 1 && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxQaPairs)
    .map((s) => s.pair)

  const allChunks = documents.flatMap((doc) => chunkDocument(doc))
  const scoredChunks = allChunks
    .map((c) => ({ chunk: c, score: overlapScore(queryTokens, tokenize(c.text)) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocChunks)
    .map((s) => s.chunk)

  return { qaPairs: scoredPairs, documentChunks: scoredChunks }
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
