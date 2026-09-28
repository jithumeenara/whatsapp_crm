/**
 * "Where did the AI get that?" — the answer, recorded with every reply.
 *
 * A reply listing five training programmes is only as good as where the
 * list came from: this year's brochure, last year's, a website page, the
 * Training table, the company profile, the account's own instructions to
 * the AI — or nowhere at all, the model filling a gap from its general
 * knowledge. Staff had no way to tell.
 *
 * Every AI-written reply now carries:
 *  • what it was given to answer from — each knowledge entry with the
 *    passages retrieved from it, ranked, plus the company profile, the
 *    instructions, and any look-ups it made;
 *  • for each line of the reply, which of those contains it — so a
 *    source can be shown as actually used, not merely provided;
 *  • the lines found in none of them. Those are what to check first:
 *    a name, date or fee the AI was never given.
 *
 * The line check compares distinctive words (three letters or more,
 * numbers of two digits or more) in Latin script. A line written wholly
 * in Malayalam around English names is judged by those names; a line
 * with nothing comparable is left unjudged rather than guessed at.
 *
 * Recorded after the message is sent and never awaited on the way there:
 * the customer's reply must not wait on bookkeeping, and a failure here
 * costs the explanation, never the answer.
 */

import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'
import type { SelectedContext } from './knowledge'

export interface AiReplySource {
  /** The knowledge entry, when it can still be found. */
  id: string | null
  name: string
  /** qa | document | website | database | sheet | chatbot | text, or
   *  company_profile | instructions | lookup | conversation. */
  kind: string
  /** Where to open it: a Data Store table or a web page. */
  table_id: string | null
  url: string | null
  /** The passages the assistant was given from this source (clipped). */
  passages: string[]
  /** How many checked reply lines were found in this source. */
  used_lines: number
  /** For a document or table: passages given, and how many it holds —
   *  equal when it was given whole. */
  given?: number
  total?: number
}

export interface AiReplyMeta {
  v: 2
  origin: 'chatbot' | 'auto_reply'
  /** How the knowledge was found: by meaning, by keywords, or none. */
  retrieval: 'semantic' | 'keyword' | 'none'
  /** How well the best passage matched the question, 0–1. */
  match: number
  /** Knowledge entries first (ranked), then the other context. */
  sources: AiReplySource[]
  /** Look-ups the assistant made (this customer's registrations…). */
  tools: string[]
  /** Reply lines that could be checked, and those found in no source. */
  checked_lines: number
  unsupported: string[]
  at: string
}

export function ensureAiMetaColumn(): Promise<void> {
  return onceSchemaPatch('messages.ai_meta', () =>
    prisma.$executeRawUnsafe('ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_meta JSONB'),
  )
}

const MAX_KNOWLEDGE_SOURCES = 8
/** Enough to show every record of a short table that was given whole. */
const MAX_PASSAGES_PER_SOURCE = 12
const MAX_PASSAGES_TOTAL = 30
const MAX_PASSAGE = 400
const MAX_UNSUPPORTED = 8

function clip(text: string, max = MAX_PASSAGE): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// ── Which source a reply line came from ─────────────────────────────────

const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has', 'will',
  'can', 'our', 'all', 'any', 'not', 'but', 'about', 'which', 'what', 'when', 'where', 'there', 'their',
  'they', 'them', 'these', 'those', 'also', 'more', 'into', 'only', 'some', 'such', 'than', 'then', 'very',
  'been', 'were', 'would', 'could', 'should', 'please', 'thank', 'thanks', 'here', 'like', 'just', 'want',
  'need', 'know', 'let', 'may', 'yes', 'how', 'who', 'why', 'its', 'out', 'one', 'use', 'get', 'per',
])

/** Distinctive words of a text: Latin words of 3+ letters and numbers of
 *  2+ digits, lower-cased, without the commonest English words. */
export function distinctiveTokens(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9]{2,}|\d{2,}/g)) {
    if (!STOP.has(m[0])) out.add(m[0])
  }
  return Array.from(out)
}

/** A reply cut into the lines a person reads: list items and sentences,
 *  with Markdown/WhatsApp marks removed. */
export function replyLines(reply: string): string[] {
  return reply
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9ഀ-ൿ])/))
    .map((l) => l.replace(/^[\s>*•\-–\d.)]+/, '').replace(/[*_~`]/g, '').trim())
    .filter((l) => l.length > 0)
}

export interface LineAttribution {
  line: string
  /** Index into the candidates, or null when found in none. */
  source: number | null
  score: number
}

/** Each checkable line, with the candidate containing most of its
 *  distinctive words (60% or more), or none. Earlier candidates win a tie,
 *  so list knowledge before instructions. */
export function attributeLines(reply: string, candidates: readonly string[]): LineAttribution[] {
  const tokenSets = candidates.map((c) => new Set(distinctiveTokens(c)))
  const out: LineAttribution[] = []
  for (const line of replyLines(reply)) {
    const tokens = distinctiveTokens(line)
    if (tokens.length < 2) continue
    let best: { index: number; score: number } | null = null
    tokenSets.forEach((set, index) => {
      const found = tokens.filter((t) => set.has(t)).length / tokens.length
      if (!best || found > best.score) best = { index, score: found }
    })
    const b = best as { index: number; score: number } | null
    out.push({ line, source: b && b.score >= 0.6 ? b.index : null, score: b ? Math.round(b.score * 100) / 100 : 0 })
  }
  return out
}

// ── Building and recording the explanation ──────────────────────────────

export async function buildReplyMeta(args: {
  accountId: string
  origin: AiReplyMeta['origin']
  reply: string
  selected: SelectedContext
  toolsUsed?: string[]
  /** What the look-ups returned. */
  toolOutputs?: string[]
  /** The company-profile block as the prompt had it. */
  companyBlock?: string
  /** The account's instructions to the AI (and a step's own, if any). */
  instructions?: string
  /** The customer's own recent words — a line echoing them is theirs. */
  conversation?: string
}): Promise<AiReplyMeta> {
  const { selected } = args
  // Ranked: Q&A first (the most direct answers), then document passages.
  const order: Array<{ id: string | null; fallbackName: string; passage: string; kind: string }> = [
    ...selected.qaPairs.map((p) => ({ id: p.id ?? null, fallbackName: p.question, passage: `Q: ${p.question}\nA: ${p.answer}`, kind: 'qa' })),
    ...selected.documentChunks.map((c) => ({ id: c.sourceId ?? null, fallbackName: c.title, passage: c.text, kind: 'document' })),
  ]

  const ids = Array.from(new Set(order.map((o) => o.id).filter((id): id is string => !!id)))
  const rows = ids.length
    ? await prisma.aiKnowledgeItem.findMany({
        where: { id: { in: ids }, account_id: args.accountId },
        select: { id: true, name: true, kind: true, source_ref: true, source_url: true },
      })
    : []
  const byId = new Map(rows.map((r) => [r.id, r]))

  // Knowledge sources, each with its full retrieved text for the check.
  const sources: AiReplySource[] = []
  const fullText: string[] = []
  let passagesLeft = MAX_PASSAGES_TOTAL
  for (const o of order) {
    const key = o.id ?? `name:${o.fallbackName}`
    let at = sources.findIndex((s) => (s.id ?? `name:${s.name}`) === key)
    if (at < 0) {
      if (sources.length >= MAX_KNOWLEDGE_SOURCES) continue
      const row = o.id ? byId.get(o.id) : undefined
      sources.push({
        id: row?.id ?? o.id,
        name: row?.name ?? o.fallbackName,
        kind: row?.kind ?? o.kind,
        table_id: row?.kind === 'database' ? row.source_ref ?? null : null,
        url: row && (row.kind === 'website' || row.kind === 'sheet') ? row.source_url ?? null : null,
        passages: [],
        used_lines: 0,
      })
      fullText.push('')
      at = sources.length - 1
    }
    fullText[at] += `\n${o.passage}`
    if (sources[at].passages.length < MAX_PASSAGES_PER_SOURCE && passagesLeft > 0) {
      sources[at].passages.push(clip(o.passage))
      passagesLeft--
    }
    const total = o.kind === 'document' && o.id ? selected.sourceTotals?.[o.id] : undefined
    if (total !== undefined) {
      sources[at].given = (sources[at].given ?? 0) + 1
      sources[at].total = total
    }
  }

  // The rest of what the assistant had in front of it.
  const extras: Array<{ kind: string; name: string; text: string }> = []
  if (args.toolOutputs?.some((t) => t.trim())) extras.push({ kind: 'lookup', name: 'Look-ups it made', text: args.toolOutputs.join('\n') })
  if (args.companyBlock?.trim()) extras.push({ kind: 'company_profile', name: 'Company profile', text: args.companyBlock })
  if (args.instructions?.trim()) extras.push({ kind: 'instructions', name: 'Your instructions to the AI', text: args.instructions })
  if (args.conversation?.trim()) extras.push({ kind: 'conversation', name: "The customer's own words", text: args.conversation })

  const candidates = [...fullText, ...extras.map((e) => e.text)]
  const lines = attributeLines(args.reply, candidates)

  const extraSources: AiReplySource[] = extras.map((e) => ({
    id: null,
    name: e.name,
    kind: e.kind,
    table_id: null,
    url: null,
    passages: [],
    used_lines: 0,
  }))
  const all = [...sources, ...extraSources]
  for (const l of lines) {
    if (l.source === null) continue
    const target = all[l.source]
    target.used_lines++
    // For the non-knowledge context, show the lines of it that were used
    // rather than the whole block — the part of a long prompt that matters.
    if (l.source >= sources.length && target.passages.length < 3) {
      const extra = extras[l.source - sources.length]
      const lineTokens = distinctiveTokens(l.line)
      const bestLine = extra.text
        .split(/\n+/)
        .map((s) => ({ s, hit: distinctiveTokens(s).filter((t) => lineTokens.includes(t)).length }))
        .sort((a, b) => b.hit - a.hit)[0]
      if (bestLine && bestLine.hit > 0) {
        const passage = clip(bestLine.s, 300)
        if (!target.passages.includes(passage)) target.passages.push(passage)
      }
    }
  }

  return {
    v: 2,
    origin: args.origin,
    retrieval: order.length === 0 ? 'none' : selected.embeddingMs !== undefined ? 'semantic' : 'keyword',
    match: Math.max(0, Math.min(1, Math.round(selected.confidence * 100) / 100)),
    // Context that contributed nothing is still listed when it is
    // knowledge (it was given); the fixed context only when it was used.
    sources: [...sources, ...extraSources.filter((s) => s.used_lines > 0)],
    tools: Array.from(new Set(args.toolsUsed ?? [])),
    checked_lines: lines.length,
    unsupported: lines.filter((l) => l.source === null).slice(0, MAX_UNSUPPORTED).map((l) => clip(l.line, 200)),
    at: new Date().toISOString(),
  }
}

/** Attaches the explanation to the message the provider id names, in
 *  this conversation. Never throws. */
export async function recordReplyMeta(args: {
  conversationId: string
  providerMessageId: string | undefined
  meta: Promise<AiReplyMeta | null>
}): Promise<void> {
  try {
    if (!args.providerMessageId) return
    const meta = await args.meta
    if (!meta) return
    await ensureAiMetaColumn().catch(() => {})
    await prisma.message.updateMany({
      where: { conversation_id: args.conversationId, message_id: args.providerMessageId },
      data: { ai_meta: meta as unknown as object },
    })
  } catch (err) {
    console.error('[ai-sources] could not record where the reply came from:', err instanceof Error ? err.message : err)
  }
}
