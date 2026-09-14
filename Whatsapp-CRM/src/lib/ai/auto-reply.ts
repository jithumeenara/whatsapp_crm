/**
 * Answering a message that no chatbot claimed.
 *
 * The gap this fills: an inbound message is offered to the flow runner
 * and then to automations, and if neither has a trigger that matches,
 * nothing happens. A keyword list only ever covers the phrasings
 * somebody thought of, so for an account whose customers ask ordinary
 * questions in their own words, most messages simply wait in the inbox.
 *
 * This runs the same pipeline the ai_reply node runs — the same
 * retrieval, prompt, safety guard, validator and confidence rules — just
 * without a flow around it. Sharing that pipeline is the point: a reply
 * sent here must not be a second, subtly different assistant from the
 * one the Test screen and the evaluation suite measure.
 *
 * Three guards, because this is the assistant talking to real customers
 * unsupervised:
 *
 *   - It stops after a set number of turns in one conversation. Two
 *     parties going back and forth with a bot that cannot help them is
 *     worse than silence.
 *   - It stops once a human has joined. An agent typing an answer while
 *     a bot talks over them in the same thread destroys more trust than
 *     a slow reply ever would.
 *   - Every handoff path the flow node has, this has too: low
 *     confidence, unverifiable details, the safety guard, and the
 *     account's own escalation directive.
 */

import { prisma } from '@/lib/db'
import { runCustomerTurn, type CustomerAiConfig } from './customer-pipeline'
import { buildHandoffNote, type HandoffReason } from './handoff-context'
import { recordAiUsage } from './usage'
import { speak } from './speech'
import { getProviderKeys } from './providers/registry'
import { decrypt } from '@/lib/whatsapp/encryption'
import { engineSendText, engineSendVoiceNote } from '@/lib/flows/meta-send'

/** How long one exchange lasts without a human touching it. WhatsApp's
 *  own session window: past it, a returning customer is starting a new
 *  conversation, and the assistant's allowance should start again. */
const EXCHANGE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Written to Message.bot_source so the limit can count the assistant's
 *  own replies without counting chatbot steps as well. */
const AI_AUTO_REPLY_SOURCE = 'ai_auto_reply'

/**
 * Tags a just-sent message as the assistant's own.
 *
 * A follow-up write on the provider's message id, rather than threading
 * a parameter through engineSendText, which every channel and every
 * other caller would have had to carry for this one purpose.
 *
 * Best effort on purpose: the customer already has the reply. Failing
 * here would at worst let the assistant answer once more than its limit,
 * which is a far smaller problem than throwing after a successful send.
 */
async function markAsAssistantReply(providerMessageId: string | undefined): Promise<void> {
  if (!providerMessageId) return
  await prisma.message
    .updateMany({
      where: { message_id: providerMessageId },
      data: { bot_source: AI_AUTO_REPLY_SOURCE },
    })
    .catch((err) =>
      console.error('[auto-reply] could not tag the reply:', err instanceof Error ? err.message : err),
    )
}

export type AutoReplyOutcome =
  | 'replied'
  | 'handed_off'
  | 'skipped_disabled'
  | 'skipped_channel'
  | 'skipped_turn_limit'
  | 'skipped_agent_active'
  | 'skipped_no_message'
  | 'failed'

export async function autoReplyToMessage(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  message: string
  channel: string
  /** True when the text is a voice note's transcript. */
  wasVoice?: boolean
}): Promise<AutoReplyOutcome> {
  const text = args.message?.trim()
  if (!text) return 'skipped_no_message'

  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
  if (!aiConfig?.ai_auto_reply_enabled) return 'skipped_disabled'

  const channels = Array.isArray(aiConfig.ai_auto_reply_channels)
    ? (aiConfig.ai_auto_reply_channels as string[])
    : ['whatsapp']
  if (!channels.includes(args.channel)) return 'skipped_channel'

  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, account_id: args.accountId },
    // assigned_agent_id, not assigned_to. Lead, Task and FollowUp all
    // call this column assigned_to; Conversation does not, and using the
    // familiar name threw at runtime on every inbound message.
    select: { assigned_agent_id: true, status: true },
  })
  if (!conversation) return 'failed'

  // Somebody owns this thread, so the assistant stays out of it.
  //
  // Assignment only. This used to treat status 'pending' the same way,
  // which was wrong in the one case that matters: Pending is where a
  // handover leaves a conversation and where people park one, and
  // neither means a person has actually picked it up. Nothing moves a
  // conversation back to Open on its own, so an unowned thread went
  // silent permanently — every later message from that customer
  // dropped, no reply, no trace outside the server log.
  //
  // What still holds a runaway back: the turn limit below caps one
  // exchange, and the safety guard runs per message, so a conversation
  // handed over for a reason that recurs is handed over again rather
  // than answered.
  if (aiConfig.ai_auto_reply_pause_on_agent && conversation.assigned_agent_id) {
    return 'skipped_agent_active'
  }

  // The window this limit actually applies to.
  //
  // It read "one unresolved exchange" and counted every bot message the
  // conversation had ever held, for its whole life — so nothing ever
  // reset it, and once a thread had accumulated enough it was mute for
  // good. A human replying ends the exchange: a person has now touched
  // whatever the assistant was failing to resolve, and the count starts
  // again from there. Failing that, 24 hours — WhatsApp's own session
  // window, past which a returning customer is starting afresh.
  const sessionStart = new Date(Date.now() - EXCHANGE_WINDOW_MS)
  const lastHumanReply = await prisma.message.findFirst({
    where: {
      conversation_id: args.conversationId,
      sender_type: 'agent',
      created_at: { gt: sessionStart },
    },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  })
  const countFrom = lastHumanReply?.created_at ?? sessionStart

  // Only the assistant's own replies. sender_type 'bot' also covers
  // chatbot steps and automation actions, and counting those against the
  // assistant let a menu — welcome, list, a few buttons, a timeout
  // message — exhaust the whole allowance before it had answered
  // anything at all.
  const botReplies = await prisma.message.count({
    where: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      bot_source: AI_AUTO_REPLY_SOURCE,
      created_at: { gt: countFrom },
    },
  })
  if (botReplies >= aiConfig.ai_auto_reply_max_turns) {
    await handOver({
      accountId: args.accountId,
      conversationId: args.conversationId,
      note: `The assistant has answered ${botReplies} times ${lastHumanReply ? 'since a colleague last replied' : 'in the last 24 hours'} without this being resolved, so it stopped and left it for a person.\n\nThey last asked: "${text.slice(0, 200)}"`,
      assignTo: aiConfig.low_confidence_assign_to,
    })
    return 'skipped_turn_limit'
  }

  // The recent thread, so the composite confidence signals — repeated
  // asking especially — can see more than the current message.
  const history = await loadHistory(args.conversationId, aiConfig.history_depth_default)

  const startedAt = Date.now()
  let turn: Awaited<ReturnType<typeof runCustomerTurn>>
  try {
    turn = await runCustomerTurn({
      aiConfig: aiConfig as unknown as CustomerAiConfig,
      accountId: args.accountId,
      contactId: args.contactId,
      customerMessage: text,
      conversationHistory: history,
      currentChannel: args.channel,
    })
  } catch (err) {
    // A provider refusal reaches a person rather than ending in silence.
    // Gemini's safety filter blocks exactly the messages that most need
    // one: an angry complaint, a customer asking for the third time.
    await handOver({
      accountId: args.accountId,
      conversationId: args.conversationId,
      note:
        buildHandoffNote({ reason: 'low_confidence', customerMessage: text }) +
        `\n\nThe assistant could not generate a reply: ${err instanceof Error ? err.message : String(err)}`,
      assignTo: aiConfig.low_confidence_assign_to,
    })
    return 'handed_off'
  }

  void recordAiUsage({
    accountId: args.accountId,
    provider: aiConfig.active_provider,
    model: getProviderKeys(aiConfig)[aiConfig.active_provider]?.model ?? 'unknown',
    feature: 'chat_customer',
    latencyMs: Date.now() - startedAt,
  })

  if (turn.decision.action === 'handoff') {
    const reason = turn.decision.reason

    // The safety guard has its own line for the customer — a plain
    // holding message would leave "can I see another student's number?"
    // looking like it was merely misunderstood.
    const customerLine =
      reason === 'safety'
        ? turn.decision.safety?.customerMessage
        : aiConfig.low_confidence_message?.trim() ||
          'Let me connect you with a team member who can help with that.'

    if (customerLine) {
      await engineSendText({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        text: customerLine,
      }).catch((err) => console.error('[auto-reply] holding message failed:', err))
    }

    await handOver({
      accountId: args.accountId,
      conversationId: args.conversationId,
      note: buildHandoffNote({
        reason: HANDOFF_REASONS[reason],
        customerMessage: text,
        draftReply: turn.reply,
        confidence: turn.confidence,
        validation: turn.validation,
        knowledgeUsed: turn.knowledgeUsed,
        toolsUsed: turn.toolsUsed,
        matchedTopic: reason === 'safety' ? turn.decision.safety?.reason : null,
      }),
      assignTo: aiConfig.low_confidence_assign_to,
    })
    return 'handed_off'
  }

  const reply = turn.decision.reply

  // Answer a voice note with a voice note, exactly as the flow node
  // does. Best effort: a synthesis failure costs the nicer format, never
  // the reply.
  if (args.wasVoice && aiConfig.voice_reply_enabled && reply.length <= aiConfig.voice_max_chars) {
    try {
      const geminiEntry = getProviderKeys(aiConfig).gemini
      const speech = await speak({
        text: reply,
        accountId: args.accountId,
        geminiApiKey: geminiEntry?.api_key ? decrypt(geminiEntry.api_key) : null,
        cloudVoice: aiConfig.cloud_voice,
        geminiVoice: aiConfig.voice_name,
      })
      const sent = await engineSendVoiceNote({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        audio: speech.buffer,
        mimeType: speech.mimeType,
        transcript: reply,
      })
      await markAsAssistantReply(sent.whatsapp_message_id)
      return 'replied'
    } catch (err) {
      console.error('[auto-reply] voice failed, sending text:', err instanceof Error ? err.message : err)
    }
  }

  try {
    const sent = await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: reply,
    })
    await markAsAssistantReply(sent.whatsapp_message_id)
    return 'replied'
  } catch (err) {
    console.error('[auto-reply] send failed:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

/** The pipeline's reasons and the note's vocabulary are close but not
 *  identical; mapped here rather than leaking one into the other. */
const HANDOFF_REASONS: Record<string, HandoffReason> = {
  low_confidence: 'low_confidence',
  unsupported_details: 'unsupported_details',
  model_requested: 'customer_requested',
  safety: 'escalation_topic',
  generation_failed: 'low_confidence',
}

async function loadHistory(conversationId: string, depth: number) {
  const rows = await prisma.message.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'desc' },
    take: Math.max(2, depth),
    select: { sender_type: true, content_text: true },
  })
  return rows
    .reverse()
    .filter((m): m is typeof m & { content_text: string } => Boolean(m.content_text))
    .map((m) => ({
      role: m.sender_type === 'customer' ? ('user' as const) : ('model' as const),
      text: m.content_text,
    }))
}

/**
 * Moves the conversation to a person.
 *
 * Deliberately not the flow engine's executeHandoff: that one belongs to
 * a FlowRun and logs against it, and there is no run here. The visible
 * outcome is the same — the conversation becomes pending, optionally
 * assigned, and carries a note somebody can act on.
 */
async function handOver(args: {
  accountId: string
  conversationId: string
  note: string
  assignTo?: string | null
}): Promise<void> {
  try {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        status: 'pending',
        ...(args.assignTo ? { assigned_agent_id: args.assignTo } : {}),
      },
    })

    // Stored as an internal note on the thread: an agent opening the
    // conversation should find the reasoning where they are already
    // looking, not in a log they would have to know to check.
    await prisma.message.create({
      data: {
        conversation_id: args.conversationId,
        sender_type: 'system',
        content_type: 'text',
        content_text: args.note,
        status: 'sent',
      },
    })

    const { emitToAccount } = await import('@/lib/socket')
    emitToAccount(args.accountId, 'conversation', {
      eventType: 'UPDATE',
      new: { id: args.conversationId, status: 'pending' },
      old: {},
    })
  } catch (err) {
    console.error('[auto-reply] handoff failed:', err instanceof Error ? err.message : err)
  }
}
