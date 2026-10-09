/**
 * The recent thread, as the assistant is shown it.
 *
 * Its own earlier replies go back to it every turn, and a model defers to
 * what it said before — "hallucination snowballing" (Zhang et al., ICML
 * 2024). Here that meant three invented programmes, repeated on every
 * later ask. Two things keep an old mistake from coming back:
 *
 *  - A reply's lines that its explanation (ai_meta, reply-sources.ts)
 *    found in no source are left out of what the model is shown.
 *  - The assistant's own turns are marked, so checks that accept "it was
 *    said in this conversation" as a source (the figures check) count
 *    only what the customer and staff said — never what it said itself.
 */

import { normalizeMalayalam } from './term-bridge'

export interface HistoryTurn {
  role: 'user' | 'model'
  text: string
  /** Written by the assistant, not by the customer or a person. */
  byAssistant?: boolean
}

export interface HistoryRow {
  sender_type: string
  content_text: string | null
  bot_source?: string | null
  ai_meta?: unknown
}

function lineForm(text: string): string {
  return normalizeMalayalam(text)
    .replace(/^[\s>*•\-–\d.)]+/, '')
    .replace(/[*_~`]/g, '')
    .replace(/…$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** The text without the lines found in no source. */
export function withoutUnsupported(text: string, unsupported: readonly string[]): string {
  const bad = unsupported.map(lineForm).filter((u) => u.length >= 10)
  if (bad.length === 0) return text
  return text
    .split('\n')
    .filter((line) => {
      const l = lineForm(line)
      if (l.length < 10) return true
      return !bad.some((u) => l.startsWith(u) || u.startsWith(l) || (u.length >= 15 && l.includes(u)))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Put before a staff member's message in what the model is shown. */
export const TEAM_MEMBER_MARKER = '[Written by a team member, not by you]'

/** The standing rule that goes with the marker (customer-pipeline.ts). */
export const TEAM_MEMBER_RULE = [
  'MESSAGES FROM THE TEAM:',
  `- Lines starting with ${TEAM_MEMBER_MARKER} were written by a person on the team. They are part of the conversation; you did not write them.`,
  '- If the customer\'s latest message answers a question a team member asked, read it as the answer to that question — not as the start of something new. Do not begin a registration, a booking or a list of options because of it. Thank them, and carry on from where the team member left off: help with what that conversation was about, using what they have now told you. If you cannot tell what the team member needed it for, say the team will follow up with them.',
  `- Never begin your own reply with ${TEAM_MEMBER_MARKER}.`,
].join('\n')

function isAssistantReply(row: HistoryRow): boolean {
  return row.sender_type === 'bot' && (row.bot_source === 'ai_auto_reply' || Boolean(row.ai_meta && typeof row.ai_meta === 'object'))
}

/** Rows oldest first → the turns the model is shown. */
export function historyTurns(rows: readonly HistoryRow[]): HistoryTurn[] {
  const out: HistoryTurn[] = []
  for (const row of rows) {
    if (!row.content_text) continue
    const byAssistant = isAssistantReply(row)
    let text = row.content_text
    if (byAssistant) {
      const unsupported = (row.ai_meta as { unsupported?: unknown } | null)?.unsupported
      if (Array.isArray(unsupported)) text = withoutUnsupported(text, unsupported.filter((u): u is string => typeof u === 'string'))
      if (!text) continue
    }
    // A person on the team wrote this, not the assistant. Both sit on the
    // business's side of the thread, so both are 'model' turns — and
    // unmarked, the model took a colleague's "may I know your
    // designation?" for its own question, read the customer's answer as
    // a registration step, and asked for a month nobody had mentioned.
    if (row.sender_type === 'agent') text = `${TEAM_MEMBER_MARKER} ${text}`
    out.push({ role: row.sender_type === 'customer' ? 'user' : 'model', text, ...(byAssistant ? { byAssistant: true } : {}) })
  }
  return out
}
