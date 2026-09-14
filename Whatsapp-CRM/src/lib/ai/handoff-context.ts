/**
 * The note an agent reads when the AI gives up.
 *
 * What it replaced, in full:
 *
 *     AI confidence 0.42 below threshold 0.35
 *
 * That tells the person picking up the conversation nothing they can
 * act on. They don't know what was asked, what the bot found, what it
 * was about to say, or why it stopped — so they open the thread and
 * start the conversation over, and the customer repeats themselves to a
 * second party. The handoff is the moment the whole system is being
 * judged, and it was the thinnest part of it.
 *
 * The note below is written to be read on a phone, in a hurry, by
 * somebody who has not seen this conversation before. Question first,
 * because that is what they need; reasoning last, because that is what
 * they'll want only if the first part looks wrong.
 */

import type { ConfidenceAssessment } from './confidence'
import type { ValidationResult } from './validator'

export type HandoffReason =
  | 'low_confidence'
  | 'unsupported_details'
  | 'escalation_topic'
  | 'customer_requested'

const REASON_HEADLINES: Record<HandoffReason, string> = {
  low_confidence: 'The assistant was not confident enough to answer',
  unsupported_details: 'The assistant drafted an answer containing details it could not verify',
  escalation_topic: 'This topic is set to always go to a person',
  customer_requested: 'The customer asked to speak to someone',
}

/** Long fields get cut rather than wrapped: this lands in a note field
 *  and an inbox preview, and an agent scrolling a wall of text will skip
 *  it entirely, which defeats the point. */
/** How much of the exchange travels with a handover. Enough to see what
 *  was tried, short enough that the reason stays at the top. */
const TRANSCRIPT_TURNS = 8

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

export function buildHandoffNote(args: {
  reason: HandoffReason
  /** What the customer actually asked. */
  customerMessage: string
  /** What the bot was going to send, when it got that far. */
  draftReply?: string | null
  confidence?: ConfidenceAssessment | null
  validation?: ValidationResult | null
  /** Titles of the knowledge entries that were retrieved, if any. */
  knowledgeUsed?: string[]
  /** Tool names called while answering. */
  toolsUsed?: string[]
  /** Department from the best-matching knowledge entry, when set. */
  department?: string | null
  /** Which topic matched, for escalation_topic handoffs. */
  matchedTopic?: string | null
  /**
   * The exchange so far, oldest first.
   *
   * Without it the agent joins a conversation at its sixth turn knowing
   * only the last question, cannot see what the assistant already tried,
   * and asks the customer to explain from the beginning — the single
   * thing people dislike most about being passed to someone else.
   */
  transcript?: { role: 'customer' | 'assistant'; text: string }[]
}): string {
  const lines: string[] = []

  lines.push(REASON_HEADLINES[args.reason])

  const question = clip(args.customerMessage, 300)
  if (question) lines.push(`\nThey asked: "${question}"`)

  if (args.matchedTopic) {
    lines.push(`Matched escalation topic: ${args.matchedTopic}`)
  }

  // The draft is the most useful thing here when it exists — often it is
  // 90% right and the agent only needs to correct one figure.
  const draft = clip(args.draftReply, 400)
  if (draft) lines.push(`\nDraft the assistant did not send:\n"${draft}"`)

  if (args.validation && !args.validation.ok) {
    lines.push(
      `\nUnverified details in that draft:\n${args.validation.issues
        .slice(0, 5)
        .map((i) => `  • ${i.value} — ${i.reason}`)
        .join('\n')}`,
    )
  }

  const knowledge = (args.knowledgeUsed ?? []).filter(Boolean)
  if (knowledge.length > 0) {
    lines.push(`\nKnowledge it found: ${knowledge.slice(0, 4).join('; ')}`)
  } else if (args.reason === 'low_confidence') {
    // Stated explicitly rather than left as an absent line: "found
    // nothing" is a different and more actionable fact than "I didn't
    // record what it found", and it tells the owner to add an entry.
    lines.push('\nKnowledge it found: nothing matched this question.')
  }

  const tools = (args.toolsUsed ?? []).filter(Boolean)
  if (tools.length > 0) lines.push(`Records it checked: ${[...new Set(tools)].join(', ')}`)

  // Last, and only the recent part of it. The whole history would push
  // the reason and the draft off the top of the note, and an agent who
  // has to scroll to find why a conversation reached them will not.
  const transcript = (args.transcript ?? []).filter((t) => t.text?.trim())
  if (transcript.length > 0) {
    const recent = transcript.slice(-TRANSCRIPT_TURNS)
    const rendered = recent
      .map((turn) => {
        const speaker = turn.role === 'customer' ? 'Them' : 'Assistant'
        return `  ${speaker}: ${clip(turn.text, 200)}`
      })
      .join('\n')
    const elided = transcript.length - recent.length
    lines.push(
      `\nThe conversation so far${elided > 0 ? ` (last ${recent.length} of ${transcript.length})` : ''}:\n${rendered}`,
    )
  }

  if (args.department) lines.push(`\nSuggested team: ${args.department}`)

  if (args.confidence) {
    lines.push(`\nWhy it stopped: ${args.confidence.explain}`)
    const penalties = args.confidence.signals.filter((s) => s.delta < 0)
    if (penalties.length > 0) {
      lines.push(penalties.map((s) => `  • ${s.detail}`).join('\n'))
    }
  }

  return lines.join('\n').trim()
}
