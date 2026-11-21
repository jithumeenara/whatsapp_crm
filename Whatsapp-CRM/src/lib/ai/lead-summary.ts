/**
 * The lead page's chat summary: what the customer wants, what we did,
 * what is left — in at most three sentences, in English. A translation
 * is a second, cached step (see the summary routes).
 *
 * Everything here is pure, so the transcript rules (what is sent to the
 * model and what is never sent) are pinned by tests:
 *  - only customer, agent and bot messages; internal notes and system
 *    lines never leave the CRM;
 *  - deleted messages are skipped;
 *  - long ID-like numbers (Aadhaar, bank, card) are masked first;
 *  - the newest messages win when the chat is long.
 */
import { maskSensitiveNumbers } from '@/lib/ai/image-reading'

/** Fewer real messages than this and there is nothing worth summarising. */
export const MIN_MESSAGES = 3
export const MAX_MESSAGES = 60
export const MAX_PER_MESSAGE = 500
export const MAX_TRANSCRIPT = 8000
export const MAX_FOCUS = 60

/** Focus chips shown on the card. Plain topics, any industry. */
export const FOCUS_PRESETS = ['fees', 'dates and schedule', 'documents', 'complaint'] as const

export interface TranscriptRow {
  sender_type: string
  content_text: string | null
  transcript?: string | null
  content_type?: string | null
  media_filename?: string | null
  created_at: Date | string
  deleted_at?: Date | string | null
}

const SPEAKER: Record<string, string> = { customer: 'Customer', agent: 'Us', bot: 'Bot' }

/** The words of one message: typed text, else the voice note's transcript, else what was sent. */
function wordsOf(r: TranscriptRow): string {
  const text = (r.content_text ?? '').trim() || (r.transcript ?? '').trim()
  if (text) return text
  if (r.content_type && r.content_type !== 'text') {
    return r.media_filename ? `[${r.content_type}: ${r.media_filename}]` : `[${r.content_type}]`
  }
  return ''
}

/**
 * The chat as the model sees it, oldest first. `rows` may come in any
 * order. Returns how many messages were used and when the newest was,
 * so the card can say "3 new messages since".
 */
export function buildSummaryTranscript(rows: TranscriptRow[]): { text: string; used: number; lastAt: Date | null } {
  const usable = rows
    .filter((r) => SPEAKER[r.sender_type] && !r.deleted_at)
    .map((r) => ({ at: new Date(r.created_at), who: SPEAKER[r.sender_type], words: wordsOf(r) }))
    .filter((r) => r.words && !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-MAX_MESSAGES)

  const lines = usable.map((r) => {
    const clean = maskSensitiveNumbers(r.words.replace(/\s+/g, ' '))
    const cut = clean.length > MAX_PER_MESSAGE ? `${clean.slice(0, MAX_PER_MESSAGE)}…` : clean
    return `${r.who}: ${cut}`
  })

  // Over the total: drop the oldest lines first; the latest state matters most.
  let total = lines.reduce((n, l) => n + l.length + 1, 0)
  let start = 0
  while (total > MAX_TRANSCRIPT && start < lines.length - 1) {
    total -= lines[start].length + 1
    start++
  }
  const kept = lines.slice(start)
  return { text: kept.join('\n'), used: kept.length, lastAt: usable.length ? usable[usable.length - 1].at : null }
}

/** '' means the whole chat. Lowercase, single spaces, no control characters, capped. */
export function normaliseFocus(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_FOCUS)
}

export function summarySystemPrompt(focus: string): string {
  const scope = focus
    ? `Summarise ONLY what the chat says about this topic: "${focus}". If the chat does not mention it, reply exactly: This chat does not mention ${focus}.`
    : 'Summarise the whole chat.'
  return [
    'You write a short note for a sales or support team member about a customer chat.',
    scope,
    'Write in English, whatever language or script the chat uses (it may be Malayalam, Manglish, Hindi or another language).',
    'At most 3 sentences and about 70 words, in this order: what the customer asked for or wants; what we replied or did; what is still open or should happen next.',
    'Use only facts in the chat. Never guess names, prices, dates or promises that are not written there.',
    'Plain text only: no headings, bullets, markdown or quotes. Do not repeat masked numbers.',
    '"Customer" lines are the customer, "Us" lines are our staff, "Bot" lines are our automatic assistant.',
  ].join('\n')
}

export function summaryUserMessage(transcript: string): string {
  return `The chat, oldest first:\n\n${transcript}`
}

/** The model's reply as a short plain note: no markdown, at most three sentences. */
export function cleanSummary(reply: string): string {
  const plain = reply
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(#+|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  const sentences = plain.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [plain]
  return sentences.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().slice(0, 700)
}

/** Languages the card offers, by the code we store translations under. */
export const SUMMARY_LANGUAGES: Record<string, string> = {
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  bn: 'Bengali',
  ar: 'Arabic',
}
