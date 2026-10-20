/**
 * AI tagging — the rules around the model, with no database or network
 * (auto-tag-rules.test.ts).
 *
 * The model may only pick from the tags the business opened to it, must
 * quote the customer's own words as evidence (checked here — a quote that
 * is not in the conversation drops the tag), and says high / medium / low.
 * High on an "auto" tag is added; anything else short of low is offered to
 * a person as a suggestion.
 */

export type Confidence = 'high' | 'medium' | 'low'
export type TagMode = 'off' | 'suggest' | 'auto'

export interface TagDecision {
  tagId: string
  confidence: Confidence
  evidence: string
  reason: string
}

/** At most this many tags the AI adds by itself in one conversation. */
export const MAX_AI_APPLIED_PER_CONVERSATION = 2
export const MAX_RUNS_PER_CONVERSATION = 3

function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function normalizeTagDecisions(raw: unknown, tagIds: readonly string[], transcript: string): TagDecision[] {
  const list = (raw as { tags?: unknown } | null)?.tags
  if (!Array.isArray(list)) return []
  const allowed = new Set(tagIds)
  const haystack = squash(transcript)
  const seen = new Set<string>()
  const out: TagDecision[] = []
  for (const item of list) {
    const r = item as Record<string, unknown>
    const tagId = typeof r.tag_id === 'string' ? r.tag_id : ''
    const confidence = r.confidence
    const evidence = typeof r.evidence === 'string' ? r.evidence.trim().slice(0, 200) : ''
    if (!allowed.has(tagId) || seen.has(tagId)) continue
    if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') continue
    // The customer must have said it — a quote the model made up drops the tag.
    if (evidence.length < 3 || !haystack.includes(squash(evidence))) continue
    seen.add(tagId)
    out.push({ tagId, confidence, evidence, reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '' })
    if (out.length >= 3) break
  }
  return out
}

export function planTagOutcomes(
  decisions: TagDecision[],
  modes: Readonly<Record<string, TagMode>>,
  alreadyApplied: number,
): Array<{ tagId: string; outcome: 'applied' | 'suggested' }> {
  let applied = alreadyApplied
  const out: Array<{ tagId: string; outcome: 'applied' | 'suggested' }> = []
  for (const d of decisions) {
    const mode = modes[d.tagId]
    if (!mode || mode === 'off' || d.confidence === 'low') continue
    if (d.confidence === 'high' && mode === 'auto' && applied < MAX_AI_APPLIED_PER_CONVERSATION) {
      out.push({ tagId: d.tagId, outcome: 'applied' })
      applied++
    } else {
      out.push({ tagId: d.tagId, outcome: 'suggested' })
    }
  }
  return out
}

const GREETINGS = new Set(['hi', 'hii', 'hiii', 'hai', 'hello', 'helo', 'hey', 'ok', 'okay', 'ഹായ്', 'ഹലോ', 'നമസ്കാരം', 'namaskaram', 'good morning', 'gm', 'thanks', 'thank you', 'start', '/start'])

/** Is there something to understand yet? A greeting alone is not. */
export function worthClassifying(customerMessages: string[]): boolean {
  const meaningful = customerMessages
    .map((m) => m.trim())
    .filter((m) => m && !GREETINGS.has(m.toLowerCase().replace(/[!.?,🙏]+$/u, '').trim()))
  const letters = meaningful.join(' ').replace(/[\s\p{P}\p{S}\d]/gu, '').length
  return letters >= 10
}
