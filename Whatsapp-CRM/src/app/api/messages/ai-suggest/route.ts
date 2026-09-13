import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { runCustomerTurn, type CustomerAiConfig } from '@/lib/ai/customer-pipeline'
import { recordAiUsage } from '@/lib/ai/usage'
import { getProviderKeys } from '@/lib/ai/providers/registry'

/**
 * Drafts a reply for an agent to look at before sending.
 *
 * This is not the auto-reply path with a person bolted on. Nothing is
 * sent: the draft lands in the composer and the agent edits, replaces or
 * discards it. That difference is the entire feature — an agent who has
 * to read and approve each line will catch the one wrong number that an
 * unattended bot would post to the customer.
 *
 * It runs the same pipeline a customer-facing reply runs, so a draft is
 * representative of what the assistant would have said. Two deliberate
 * differences from that path:
 *
 *   - A handoff is not an outcome here. The agent *is* the handoff. When
 *     the pipeline would have escalated, the draft still comes back,
 *     with the reason attached so the agent can see what the assistant
 *     was unsure about rather than being handed a blank box.
 *   - Agent role, not admin. Drafting a reply in a conversation an agent
 *     already has open exposes nothing they cannot see, so gating it at
 *     admin would only stop the people who actually answer messages.
 */

export const dynamic = 'force-dynamic'

/** Enough to follow the thread; more just costs latency in front of
 *  somebody waiting to type. */
const HISTORY_DEPTH = 10

export async function POST(req: Request) {
  let accountId: string
  try {
    accountId = (await getCurrentAccount()).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as {
    conversation_id?: string
    /** Optional steer: "shorter", "ask for their number", "apologise". */
    instruction?: string
  } | null

  const conversationId = body?.conversation_id
  if (!conversationId) {
    return NextResponse.json({ error: 'A conversation is required.' }, { status: 400 })
  }

  // account_id in the filter, not only the id: a conversation from
  // another account must not resolve even if an id were guessed.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, account_id: accountId },
    select: { id: true, contact_id: true, channel: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
  }

  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  if (!aiConfig) {
    return NextResponse.json(
      { error: 'Set up the AI assistant in Settings before drafting replies.' },
      { status: 400 },
    )
  }

  const history = await prisma.message.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'desc' },
    take: HISTORY_DEPTH,
    select: { sender_type: true, content_text: true },
  })

  const ordered = history
    .reverse()
    .filter((m): m is typeof m & { content_text: string } => Boolean(m.content_text))

  // The last thing the customer said is what a reply answers. Falling
  // back to the newest message of any kind would have the assistant
  // replying to the agent's own last line.
  const lastCustomer = [...ordered].reverse().find((m) => m.sender_type === 'customer')
  if (!lastCustomer) {
    return NextResponse.json(
      { error: 'There is nothing from the customer to reply to yet.' },
      { status: 400 },
    )
  }

  const conversationHistory = ordered.map((m) => ({
    role: m.sender_type === 'customer' ? ('user' as const) : ('model' as const),
    text: m.content_text,
  }))

  const startedAt = Date.now()
  try {
    const turn = await runCustomerTurn({
      aiConfig: {
        ...aiConfig,
        // The agent reads every draft before it goes anywhere, so the
        // two code-enforced stops are turned off here: both would return
        // an empty draft, which is strictly less useful to a person than
        // a flawed one they can see and correct. The reasons still come
        // back below.
        low_confidence_handoff_enabled: false,
        response_validation_enabled: true,
        ...(body?.instruction?.trim()
          ? { system_prompt: `${aiConfig.system_prompt ?? ''}\n\nFor this reply specifically: ${body.instruction.trim()}` }
          : {}),
      } as unknown as CustomerAiConfig,
      accountId,
      contactId: conversation.contact_id,
      customerMessage: lastCustomer.content_text,
      conversationHistory,
      currentChannel: conversation.channel ?? 'whatsapp',
    })

    void recordAiUsage({
      accountId,
      provider: aiConfig.active_provider,
      model: getProviderKeys(aiConfig)[aiConfig.active_provider]?.model ?? 'unknown',
      feature: 'chat_customer',
      latencyMs: Date.now() - startedAt,
    })

    const draft = turn.reply ?? ''
    if (!draft.trim()) {
      return NextResponse.json(
        { error: 'The assistant had nothing to suggest for this message.' },
        { status: 400 },
      )
    }

    // Warnings rather than refusals. The agent decides; this only makes
    // sure they are deciding with the same information the automatic
    // path would have acted on.
    const warnings: string[] = []
    if (turn.decision.action === 'handoff') {
      if (turn.decision.reason === 'unsupported_details') {
        warnings.push(
          turn.validation?.summary ??
            'Some details in this draft could not be checked against your knowledge base.',
        )
      } else if (turn.decision.reason === 'safety') {
        warnings.push(turn.decision.safety?.reason ?? 'This question is one the assistant will not answer on its own.')
      } else if (turn.decision.reason === 'model_requested') {
        warnings.push('The assistant judged this one to need a person — which is you.')
      }
    }
    if (turn.effectiveConfidence < aiConfig.confidence_threshold) {
      warnings.push(`Weak knowledge match (${turn.effectiveConfidence.toFixed(2)}). Check the facts before sending.`)
    }
    if (turn.truncated) warnings.push('The draft was cut off at the length limit.')

    return NextResponse.json({
      draft,
      replying_to: lastCustomer.content_text.slice(0, 300),
      confidence: turn.effectiveConfidence,
      sources: turn.knowledgeUsed.slice(0, 6),
      warnings,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not draft a reply.' },
      { status: 400 },
    )
  }
}
