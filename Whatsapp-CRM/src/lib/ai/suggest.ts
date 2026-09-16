/**
 * A draft reply for the person who is about to type one.
 *
 * The assistant already knows the company profile, the knowledge base and
 * this customer's own record. Until now it only ever used them to answer
 * on its own — so the moment a conversation reached a human, all of it
 * stopped being useful, and the agent went looking for the fee list in a
 * spreadsheet the bot could have quoted instantly.
 *
 * This is the same pipeline, stopped one step short of sending. Nothing
 * is written, nothing is delivered, no state moves: the text lands in the
 * agent's box and they decide what to do with it. That distinction is the
 * whole design — a suggestion an agent cannot edit is just a slower bot,
 * and a suggestion that sends itself is a bot pretending to be an agent.
 */

import { prisma } from '@/lib/db'
import { runCustomerTurn, type CustomerAiConfig } from './customer-pipeline'

export type SuggestOutcome =
  | {
      ok: true
      suggestion: string
      /** What the assistant leant on, so the agent can judge the answer. */
      knowledgeUsed: string[]
      confidence: number
      /**
       * True when the assistant would have escalated rather than
       * answered. The draft is still offered — an agent reading it is
       * exactly the safeguard the escalation exists to reach — but the
       * UI says so, because a low-confidence answer that looks confident
       * is the one that gets sent without being read.
       */
      lowConfidence: boolean
    }
  | { ok: false; reason: SuggestFailure }

export type SuggestFailure =
  | 'no_conversation'
  | 'no_customer_message'
  | 'no_ai_config'
  | 'blocked'
  | 'failed'

/** Matches the auto-reply path, so a suggestion reads like the assistant. */
const HISTORY_FALLBACK_DEPTH = 10

export async function suggestReply(args: {
  accountId: string
  conversationId: string
}): Promise<SuggestOutcome> {
  const conversation = await prisma.conversation
    .findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { id: true, contact_id: true },
    })
    .catch(() => null)
  if (!conversation) return { ok: false, reason: 'no_conversation' }

  const aiConfig = await prisma.aiConfig
    .findUnique({ where: { account_id: args.accountId } })
    .catch(() => null)
  if (!aiConfig) return { ok: false, reason: 'no_ai_config' }

  // Suggesting is gated on the assistant being configured at all, not on
  // ai_auto_reply_enabled. An account that deliberately answers every
  // message by hand is exactly the one this helps most.
  const depth = aiConfig.history_depth_default ?? HISTORY_FALLBACK_DEPTH
  const rows = await prisma.message.findMany({
    where: { conversation_id: conversation.id },
    orderBy: { created_at: 'desc' },
    take: Math.max(2, depth),
    select: { sender_type: true, content_text: true },
  })

  const ordered = rows
    .reverse()
    .filter((m): m is typeof m & { content_text: string } => Boolean(m.content_text))

  // The message being answered is the customer's most recent one. Read
  // from the end rather than the start: an agent asks for help after a
  // customer has spoken, and it is that turn they are replying to.
  const lastCustomer = [...ordered].reverse().find((m) => m.sender_type === 'customer')
  if (!lastCustomer) return { ok: false, reason: 'no_customer_message' }

  // History excludes the message being answered — the pipeline takes it
  // separately, and sending it twice makes the model answer itself.
  const lastIndex = ordered.lastIndexOf(lastCustomer)
  const history = ordered.slice(0, lastIndex).map((m) => ({
    role: m.sender_type === 'customer' ? ('user' as const) : ('model' as const),
    text: m.content_text,
  }))

  try {
    const turn = await runCustomerTurn({
      aiConfig: aiConfig as unknown as CustomerAiConfig,
      accountId: args.accountId,
      contactId: conversation.contact_id,
      customerMessage: lastCustomer.content_text,
      conversationHistory: history,
      currentChannel: 'whatsapp',
    })

    // The safety guard refuses to draft at all — someone trying to talk
    // the assistant out of its instructions, or asking after another
    // customer's details. An agent does not need a draft for that, and
    // producing one would be handing them the exact text the guard
    // exists to prevent.
    if (turn.decision.action === 'handoff' && turn.decision.reason === 'safety') {
      return { ok: false, reason: 'blocked' }
    }

    const text = turn.reply?.trim()
    if (!text) return { ok: false, reason: 'failed' }

    return {
      ok: true,
      suggestion: text,
      knowledgeUsed: turn.knowledgeUsed,
      confidence: turn.effectiveConfidence,
      lowConfidence: turn.decision.action === 'handoff',
    }
  } catch (err) {
    console.warn(
      '[ai-suggest] could not draft a reply:',
      err instanceof Error ? err.message : err,
    )
    return { ok: false, reason: 'failed' }
  }
}
