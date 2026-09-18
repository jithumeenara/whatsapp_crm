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
import { runCustomerTurn, formatTurnTimings, type CustomerAiConfig } from './customer-pipeline'
import { buildHandoffNote, type HandoffReason } from './handoff-context'
import { recordAiUsage } from './usage'
import { speak } from './speech'
import { getProviderKeys } from './providers/registry'
import { sendHandoffAlert } from './handoff-alert'
import { decrypt } from '@/lib/whatsapp/encryption'
import { engineSendText, engineSendVoiceNote } from '@/lib/flows/meta-send'

/** How long one exchange lasts without a human touching it. WhatsApp's
 *  own session window: past it, a returning customer is starting a new
 *  conversation, and the assistant's allowance should start again. */
const EXCHANGE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Written to Message.bot_source so the limit can count the assistant's
 *  own replies without counting chatbot steps as well. */
export const AI_AUTO_REPLY_SOURCE = 'ai_auto_reply'

/**
 * The first line of the note left when the assistant runs out of turns.
 *
 * A constant because it is also the thing looked for: the note is
 * written once per exchange, and "has one been written already" is
 * answered by searching for this opening rather than by a marker
 * nobody reading the Inbox would want to see.
 */
const TURN_LIMIT_NOTE_OPENING = 'The assistant stopped answering this conversation.'

/**
 * Whether this exact sentence has already gone out recently.
 *
 * Both places that send a holding line need this, and for the same
 * reason: a customer who replies "Ok" to "let me connect you with a
 * colleague" must not be told to wait for a colleague again, and then a
 * third time when they say "ok thanks".
 */
async function saidRecently(conversationId: string, text: string): Promise<boolean> {
  const found = await prisma.message.findFirst({
    where: {
      conversation_id: conversationId,
      sender_type: { not: 'contact' },
      content_text: text,
      created_at: { gte: new Date(Date.now() - EXCHANGE_WINDOW_MS) },
    },
    select: { id: true },
  })
  return Boolean(found)
}

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
  /** The inbound message's wamid, used to mark it read and show the
   *  typing bubble while the model works. Optional: every other channel
   *  has no such thing, and a missing one costs only the indicator. */
  providerMessageId?: string
}): Promise<AutoReplyOutcome> {
  const text = args.message?.trim()
  if (!text) return 'skipped_no_message'

  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
  if (!aiConfig?.ai_auto_reply_enabled) return 'skipped_disabled'

  const channels = Array.isArray(aiConfig.ai_auto_reply_channels)
    ? (aiConfig.ai_auto_reply_channels as string[])
    : ['whatsapp']
  if (!channels.includes(args.channel)) return 'skipped_channel'

  // Blue ticks and a typing bubble, before anything slow rather than
  // after it.
  //
  // Retrieval, tool calls and generation take seconds, and the customer
  // used to spend those seconds looking at a message that had not even
  // been marked read — which reads as nobody being there. The reply is
  // no faster for this; it just stops feeling abandoned, which is most
  // of what "too slow" actually means.
  //
  // Fired here rather than after the guard queries, and fired without
  // being awaited: the indicator must never delay the thing it is
  // covering for. Being early costs one case — a thread that turns out
  // to be owned by an agent gets its message marked read by a bot that
  // will not answer it — and that was already true, since the bot has
  // in fact read it.
  if (args.providerMessageId && args.channel === 'whatsapp') {
    void showTyping({
      accountId: args.accountId,
      conversationId: args.conversationId,
      providerMessageId: args.providerMessageId,
    })
  }

  // Every guard's data, fetched at once.
  //
  // These four reads have nothing to say to each other — who owns the
  // thread, when a colleague last replied, what the assistant has
  // already said, and the recent transcript — and they used to run one
  // after another, in the gap between a customer's message and the first
  // sign that anybody had seen it. Four round trips became one wait.
  //
  // The turn count is the only one that needed rearranging: it depended
  // on the timestamp of the human reply, so it could not be a `count`
  // running alongside the query that finds that timestamp. Both now read
  // the same 24-hour window and the count is finished in memory, over a
  // handful of rows.
  const sessionStart = new Date(Date.now() - EXCHANGE_WINDOW_MS)
  const [conversation, lastHumanReply, botRepliesInWindow, history] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      // assigned_agent_id, not assigned_to. Lead, Task and FollowUp all
      // call this column assigned_to; Conversation does not, and using the
      // familiar name threw at runtime on every inbound message.
      select: { assigned_agent_id: true, status: true },
    }),
    prisma.message.findFirst({
      where: {
        conversation_id: args.conversationId,
        sender_type: 'agent',
        created_at: { gt: sessionStart },
      },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    }),
    // Only the assistant's own replies. sender_type 'bot' also covers
    // chatbot steps and automation actions, and counting those against
    // the assistant let a menu — welcome, list, a few buttons, a timeout
    // message — exhaust the whole allowance before it had answered
    // anything at all.
    prisma.message.findMany({
      where: {
        conversation_id: args.conversationId,
        sender_type: 'bot',
        bot_source: AI_AUTO_REPLY_SOURCE,
        created_at: { gt: sessionStart },
      },
      select: { created_at: true },
    }),
    // The recent thread, so the composite confidence signals — repeated
    // asking especially — can see more than the current message.
    loadHistory(args.conversationId, aiConfig.history_depth_default),
  ])

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
  //
  // Zero means no limit at all. An account can switch the cap off on the
  // Chatbot page, and this is where that decision lands — deliberately a
  // number rather than a second boolean, so there is one thing to read
  // when somebody asks why the assistant stopped.
  const countFrom = lastHumanReply?.created_at ?? sessionStart
  const botReplies = botRepliesInWindow.filter((m) => m.created_at > countFrom).length
  const turnLimit = aiConfig.ai_auto_reply_max_turns
  if (turnLimit > 0 && botReplies >= turnLimit) {
    // Out of turns is not a reason to stop speaking to the customer.
    //
    // Found in a live log: two conversations had reached the limit, and
    // every message after it produced a server line, a fresh note on the
    // thread, and *nothing at all* to the person who wrote. One of them
    // had written seven times into total silence. That is worse than any
    // bad answer the limit exists to prevent — the customer cannot tell
    // "a person is coming" from "this number is dead", and the only
    // difference visible to them is that the assistant stopped
    // mid-conversation.
    //
    // So they are told, once, in the same words the low-confidence
    // handover uses, and the note is written once per exchange rather
    // than once per message. Both guards look back over the same window
    // the count itself uses, so a new exchange — a colleague replying,
    // or a fresh day — gets a fresh note and a fresh line.
    const alreadyNoted = await prisma.message.findFirst({
      where: {
        conversation_id: args.conversationId,
        sender_type: 'system',
        content_text: { startsWith: TURN_LIMIT_NOTE_OPENING },
        created_at: { gt: countFrom },
      },
      select: { id: true },
    })

    if (!alreadyNoted) {
      const customerLine =
        aiConfig.low_confidence_message?.trim() ||
        'Let me connect you with a team member who can help with that.'

      if (!(await saidRecently(args.conversationId, customerLine))) {
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
        note: [
          TURN_LIMIT_NOTE_OPENING,
          '',
          `It answered ${botReplies} times ${lastHumanReply ? 'since a colleague last replied' : 'in the last 24 hours'} without this being resolved, so it left the rest for a person. It will start answering again once somebody here replies.`,
          '',
          `They last asked: "${text.slice(0, 200)}"`,
        ].join('\n'),
        assignTo: aiConfig.low_confidence_assign_to,
      })
    }

    return 'skipped_turn_limit'
  }

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
      conversationId: args.conversationId,
      userId: args.userId,
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

  const model = getProviderKeys(aiConfig)[aiConfig.active_provider]?.model ?? 'unknown'

  void recordAiUsage({
    accountId: args.accountId,
    provider: aiConfig.active_provider,
    model,
    feature: 'chat_customer',
    // Previously omitted, so the single most-used feature in the app
    // recorded zero tokens and zero cost on every reply. The Usage tab
    // was not under-reporting the chat; it was reporting none of it.
    tokens: turn.usage ?? undefined,
    latencyMs: Date.now() - startedAt,
  })

  // One line per reply, saying where the time went.
  //
  // "The AI is slow" is always reported after the fact, about a message
  // nobody kept, and it never reproduces on the Test screen — where the
  // knowledge base is already cached and no WhatsApp round trip is
  // involved. Without this the only available answer is a guess, and the
  // guesses have been wrong before: the obvious suspect was retrieval,
  // and the real cost turned out to be the model deliberating before it
  // spoke.
  //
  // Written at log level 'info' rather than behind a debug flag, because
  // a number that only exists while somebody is watching is a number
  // nobody ever has. `pm2 logs whatsapp-crm | grep ai-latency`.
  console.log(
    `[ai-latency] ${formatTurnTimings(turn.timings, {
      model,
      effort: aiConfig.reasoning_effort ?? 'low',
      tools: turn.toolsUsed.length > 0 ? turn.toolsUsed.join('+') : 'none',
      knowledge: turn.knowledgeUsed.length,
      conv: args.conversationId.slice(0, 8),
    })}`,
  )

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

    // Say it once, not once per message.
    //
    // A handover leaves the conversation Pending, and Pending does not
    // stop the assistant — deliberately, because nothing moves a thread
    // back to Open and treating Pending as "a person has this" left
    // unowned conversations silent forever. But the consequence was that
    // every further message handed off again and sent the *same sentence
    // again*. A customer who replies "Ok" to "let me connect you with a
    // team member" is told to wait for a team member. Then they say "Ok,
    // I understand", and are told a third time.
    //
    // The handover still repeats — that part is right, since a reason
    // that recurs deserves a fresh note for whoever picks the thread up.
    // Only the line to the customer is suppressed, and only while the
    // identical one is still the last thing the assistant said to them.
    const alreadySaid = customerLine ? await saidRecently(args.conversationId, customerLine) : false

    if (customerLine && !alreadySaid) {
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
        // The history already loaded for the model, reused rather than
        // re-queried, plus the message that triggered the handover —
        // which is not in it, having arrived after it was read.
        transcript: [
          ...history.map((h) => ({
            role: h.role === 'user' ? ('customer' as const) : ('assistant' as const),
            text: h.text,
          })),
          { role: 'customer' as const, text },
        ],
      }),
      assignTo: aiConfig.low_confidence_assign_to,
    })

    // And tell a person on the channel they actually watch.
    //
    // Deliberately after the handover and deliberately not awaited into
    // the outcome: the conversation is already flagged and the note is
    // already written, which is the part that must not fail. An alert
    // that cannot be delivered is logged with the number it failed for
    // rather than swallowed, but it never costs the handover itself.
    void sendHandoffAlert({
      accountId: args.accountId,
      conversationId: args.conversationId,
      reason,
      customerMessage: text,
      contact: await prisma.contact
        .findUnique({
          where: { id: args.contactId },
          select: { name: true, phone: true },
        })
        .catch(() => null),
    })

    return 'handed_off'
  }

  const reply = turn.decision.reply

  // The assistant handed this conversation to one of the business's own
  // chatbots, and that bot has already sent its first message. Sending
  // the assistant's text now would put two voices in the thread at once,
  // the second of them talking about a menu the customer is looking at.
  //
  // Enforced here rather than left to the model. It is told to say
  // nothing, and usually does; "usually" is not good enough for
  // something the customer sees.
  if (turn.handedToChatbot) {
    console.log(`[auto-reply] handed ${args.conversationId} to a chatbot; staying quiet`)
    return 'replied'
  }

  // The model answered, and also asked for a person.
  //
  // Both happen: the customer keeps their answer and the thread is put
  // in front of somebody. No holding line — there is nothing to hold
  // for, the answer is already on its way — and the conversation is
  // flagged rather than reassigned, so the assistant can carry on if the
  // customer writes again before anyone picks it up.
  if (turn.decision.notifyHuman) {
    void handOver({
      accountId: args.accountId,
      conversationId: args.conversationId,
      note: buildHandoffNote({
        reason: 'customer_requested',
        customerMessage: text,
        draftReply: reply,
        confidence: turn.confidence,
        validation: turn.validation,
        knowledgeUsed: turn.knowledgeUsed,
        toolsUsed: turn.toolsUsed,
        transcript: [
          ...history.map((h) => ({
            role: h.role === 'user' ? ('customer' as const) : ('assistant' as const),
            text: h.text,
          })),
          { role: 'customer' as const, text },
        ],
      }),
      assignTo: aiConfig.low_confidence_assign_to,
    })
    void sendHandoffAlert({
      accountId: args.accountId,
      conversationId: args.conversationId,
      reason: 'model_requested',
      customerMessage: text,
      contact: await prisma.contact
        .findUnique({ where: { id: args.contactId }, select: { name: true, phone: true } })
        .catch(() => null),
    })
  }

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

/**
 * Marks the inbound message read and shows "typing…".
 *
 * Entirely best effort. Every failure path here — no number resolvable,
 * a token Meta has rotated, a wamid too old to mark read — costs a
 * cosmetic indicator and nothing else, so none of them are allowed to
 * reach the caller or appear as an error the user has to think about.
 */
async function showTyping(args: {
  accountId: string
  conversationId: string
  providerMessageId: string
}): Promise<void> {
  try {
    const { resolveWhatsAppConfig } = await import('@/lib/whatsapp/resolve-config')
    const { sendTypingIndicator } = await import('@/lib/whatsapp/meta-api')
    const config = await resolveWhatsAppConfig({
      accountId: args.accountId,
      conversationId: args.conversationId,
    })
    await sendTypingIndicator({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      messageId: args.providerMessageId,
    })
  } catch (err) {
    console.warn('[auto-reply] typing indicator skipped:', err instanceof Error ? err.message : err)
  }
}
