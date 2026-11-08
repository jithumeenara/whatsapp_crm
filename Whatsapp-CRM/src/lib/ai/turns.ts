/**
 * The turns sent to Gemini, arranged the way it accepts them. Shared by
 * the customer agent's tool path and the plain reply path, so a fallback
 * cannot fail for the same reason as the path it stands in for.
 */

import type { Content } from '@google/generative-ai'

/** Stands in for a message that came with no text, so the request still ends on the customer. */
export const NO_TEXT_MESSAGE = '(The customer sent a message with no text, for example a photo, sticker or voice note.)'
/** Opens a conversation the business started, so nothing it said is dropped. */
export const BUSINESS_STARTED = '(The business wrote first.)'

/**
 * The conversation so far, then this message.
 *
 * Gemini refuses a request that ends on a model turn, and drops an empty
 * text part, so a latest message with no text (a photo or sticker without
 * a caption) made the request end on the model's reply: "Requests ending
 * with a model turn are not supported", seen in production with
 * `model[text] > model[text] > user[EMPTY-TEXT]`. So: empty turns are
 * dropped, turns of the same role in a row are joined (every word kept,
 * in order), a conversation the business opened gets a short customer
 * turn in front, and the last customer turn always has text.
 */
export function buildContents(history: { role: 'user' | 'model'; text: string }[], userMessage: string): Content[] {
  const turns = [...history, { role: 'user' as const, text: userMessage.trim() ? userMessage : NO_TEXT_MESSAGE }]
  const out: Content[] = []
  for (const t of turns) {
    if (!t.text?.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === t.role) last.parts.push({ text: t.text })
    else {
      if (!out.length && t.role === 'model') out.push({ role: 'user', parts: [{ text: BUSINESS_STARTED }] })
      out.push({ role: t.role, parts: [{ text: t.text }] })
    }
  }
  return out
}
