/**
 * Keeps the items a reply lists to what the assistant was given this turn.
 *
 * ── The failure ─────────────────────────────────────────────────────
 *
 * Asked "which training programmes are there?", the assistant listed
 * "Leadership and Good Governance (Rule 50 A)", "Business Development
 * Plan" and "Self-Sustenance…" although the Training table it was given
 * — whole — had none of them. It took them from its own earlier replies
 * in the same chat: the last few messages go back to the model every
 * turn, so one wrong answer repeated itself on every later ask. The
 * number check (validator.ts) could not catch it — there are no numbers
 * in a name, and it counts that history as a source anyway.
 *
 * ── Two layers ──────────────────────────────────────────────────────
 *
 * GROUNDING_RULES tells the model that its earlier replies are not a
 * source. That is advice. This file's check is not: every list item that
 * names something must be found in this turn's material — knowledge,
 * look-ups, company profile, instructions, the customer's own words. An
 * item that is not gets one rewrite with the items named; any still
 * there afterwards is removed before the reply is sent.
 *
 * Latin words and numbers are compared (as in reply-sources); an item
 * written wholly in Malayalam is not judged. Only list items are checked:
 * a list is where a reply claims "these are the things we have".
 */

import { distinctiveTokens } from './reply-sources'

export const GROUNDING_RULES = [
  'WHERE FACTS COME FROM:',
  '- Names of programmes, courses, products and services, and their dates and fees, come only from the reference material and look-up results given in this message.',
  '- Your own earlier replies in this conversation are NOT a source. They may be wrong or out of date. If an earlier reply of yours lists something the reference material does not have, that reply was a mistake: do not repeat it.',
  '- A source marked "complete" is the full list. Never add items to it from anywhere else, including general knowledge.',
].join('\n')

/** "- item", "• item", "* item", "1. item", "2) item". Not "*bold*". */
const LIST_ITEM = /^\s*(?:[-•–▪◦]|\*(?=\s)|\d{1,2}[.)])\s+\S/

/** The list items in a reply that name something no source contains. */
export function ungroundedListItems(reply: string, sources: readonly string[]): string[] {
  const known = new Set<string>()
  for (const s of sources) if (s) for (const t of distinctiveTokens(s)) known.add(t)

  const out: string[] = []
  for (const line of reply.split('\n')) {
    if (!LIST_ITEM.test(line)) continue
    const tokens = distinctiveTokens(line)
    if (tokens.length < 2) continue
    const missing = tokens.filter((t) => !known.has(t))
    // Most of its words, and at least two of them, appear nowhere.
    if (missing.length >= 2 && (tokens.length - missing.length) / tokens.length < 0.6) out.push(line.trim())
  }
  return out
}

/** The reply without those lines. */
export function removeLines(reply: string, lines: readonly string[]): string {
  const drop = new Set(lines.map((l) => l.trim()))
  return reply
    .split('\n')
    .filter((l) => !drop.has(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Appended to the system prompt for the one rewrite. */
export function groundingCorrection(items: readonly string[], lookups: readonly string[] = []): string {
  const parts: string[] = []
  // The rewrite runs without tools, so what they returned is repeated.
  if (lookups.some((l) => l.trim())) {
    parts.push(`LOOK-UP RESULTS ALREADY FETCHED THIS TURN:\n${lookups.join('\n')}`)
  }
  parts.push(
    [
      'CORRECTION — your previous draft listed the items below, and none of them is in the reference material or look-up results given in this message:',
      ...items.map((i) => `  ${i}`),
      'They came from your own earlier replies in this chat or from general knowledge — both are wrong sources here.',
      'Write the reply again, listing only what the reference material and look-up results contain. Keep the same language and tone.',
    ].join('\n'),
  )
  return parts.join('\n\n')
}

/**
 * Checks a reply's list, asks for one rewrite when it names things no
 * source has, and removes whatever is still unsupported after that.
 *
 * `regenerate` returns the rewritten reply (already WhatsApp-formatted),
 * or null when the rewrite failed — the original is then used, minus
 * its unsupported lines.
 */
export async function enforceGroundedList(args: {
  reply: string
  sources: readonly string[]
  /** What this turn's look-ups returned, repeated for the rewrite. */
  lookups?: readonly string[]
  regenerate: (correction: string) => Promise<string | null>
}): Promise<{ reply: string; caught: string[]; rewritten: boolean }> {
  const caught = ungroundedListItems(args.reply, args.sources)
  if (caught.length === 0) return { reply: args.reply, caught: [], rewritten: false }

  let rewrite: string | null = null
  try {
    rewrite = await args.regenerate(groundingCorrection(caught, args.lookups))
  } catch {
    rewrite = null
  }
  const candidate = rewrite?.trim() ? rewrite : args.reply
  const still = ungroundedListItems(candidate, args.sources)
  const cleaned = still.length ? removeLines(candidate, still) : candidate
  return { reply: cleaned, caught, rewritten: Boolean(rewrite?.trim()) }
}
