/**
 * Action tokens an account's own prompt asks the model to emit.
 *
 * Found in live testing rather than designed. This account's system
 * prompt contains:
 *
 *     "If the user wants to book a session, modify a registration, or
 *      report a technical issue, append `[ACTION: TRIGGER_HUMAN_ADMIN]`
 *      to your reply"
 *
 * The model obeys — and the literal string `[ACTION: TRIGGER_HUMAN_ADMIN]`
 * was being sent to the customer at the end of the message, because
 * nothing downstream knew it meant anything. The intent behind writing
 * that instruction was clearly "get a person involved", so the token is
 * now honoured: stripped from what the customer sees, and turned into an
 * actual handoff.
 *
 * Recognising a convention an account already invented beats telling
 * them their prompt is wrong. Accounts that never write such a token are
 * unaffected — there is nothing to match.
 */

export type DetectedAction = 'handoff' | 'unknown'

export interface ActionScan {
  /** The reply with every token removed, ready to send. */
  cleanedText: string
  /** Distinct actions found, in the order they appeared. */
  actions: DetectedAction[]
  /** Raw token text, for the flow-run log. */
  rawTokens: string[]
}

/**
 * Token names that mean "a person needs to take this over".
 *
 * Matched loosely because prompts are written by people, not compilers:
 * TRIGGER_HUMAN_ADMIN, HUMAN_HANDOFF, ESCALATE, TRANSFER_TO_AGENT and
 * NOTIFY_STAFF all obviously mean the same thing, and an account should
 * not have to discover the one spelling this code accepts.
 */
const HANDOFF_PATTERN = /human|agent|staff|admin|escalat|handoff|hand_off|transfer|support/i

/**
 * Bracketed directives: [ACTION: X], [ACTION:X], {{ACTION: X}}, <ACTION: X>.
 *
 * Anchored on the word ACTION so ordinary bracketed prose — "[see the
 * attached form]" — is left alone. A reply legitimately containing
 * square brackets is far more common than one containing a directive.
 */
const ACTION_TOKEN = /[[{<]{1,2}\s*ACTION\s*[:=]\s*([A-Z0-9_ -]+?)\s*[\]}>]{1,2}/gi

/**
 * Citation artifacts from pasted source documents — `[cite: 1]`,
 * `[cite_start]`, `[citation: 4]`.
 *
 * These come from PDFs and exported documents pasted into a prompt or a
 * knowledge entry. The model copies them into replies, where they look
 * to a customer like the message is broken. This account's own system
 * prompt is full of them.
 */
const CITATION_ARTIFACT = /\[\s*cite(?:_start|_end|ation)?\s*[:\s][^\]]*\]|\[\s*cite(?:_start|_end)\s*\]/gi

export function scanActionTokens(text: string): ActionScan {
  const rawTokens: string[] = []
  const actions: DetectedAction[] = []

  let cleaned = (text || '').replace(ACTION_TOKEN, (match, name: string) => {
    rawTokens.push(match)
    const action: DetectedAction = HANDOFF_PATTERN.test(name) ? 'handoff' : 'unknown'
    if (!actions.includes(action)) actions.push(action)
    return ''
  })

  cleaned = cleaned.replace(CITATION_ARTIFACT, '')

  // Removing a token from the end usually leaves a trailing blank line,
  // and removing an inline one leaves a double space.
  cleaned = cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText: cleaned, actions, rawTokens }
}
