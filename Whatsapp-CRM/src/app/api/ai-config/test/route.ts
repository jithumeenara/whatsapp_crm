import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/whatsapp/encryption'
import { PROVIDERS, getProviderKeys } from '@/lib/ai/providers/registry'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { recordAiUsage } from '@/lib/ai/usage'
import { runCustomerTurn, type CustomerAiConfig } from '@/lib/ai/customer-pipeline'

/**
 * Test AI (Customer) — the assistant a customer would actually get.
 *
 * ── Why this was rewritten ──────────────────────────────────────────
 *
 * This route used to be a second, simpler implementation of the customer
 * reply path: retrieval, a prompt, one model call. It shared no code
 * with what answers a real WhatsApp message, and the gap showed up in
 * testing as behaviour nobody could explain.
 *
 * A real transcript from this screen: the customer asked to register,
 * and the reply ended with the literal text
 * "[ACTION: TRIGGER_HUMAN_ADMIN]" — a directive the live path strips and
 * turns into a handover, which this route knew nothing about. Then they
 * answered "yes" to a question the assistant had just asked, and got
 * "Great! How can I assist you today?", because no conversation history
 * was sent and every message started from nothing. And no tool was ever
 * offered, so the assistant could not take the registration it was being
 * asked for even once that feature existed.
 *
 * None of those were bugs in the assistant. They were bugs in the copy
 * of it that this screen ran — the worst possible place for them, since
 * this is the screen people use to decide whether the assistant works.
 *
 * So the preview now calls `runCustomerTurn`, the same function the
 * WhatsApp path calls. Everything follows from that: history, action
 * tokens, tools, the safety guard, the validator, confidence handoff.
 * When a handoff would happen, this screen says so instead of silently
 * showing a reply that production would never have sent.
 *
 * What it still allows, because it is the point of a test screen, is
 * overriding the unsaved settings — a prompt, model, temperature or key
 * being tried before it is saved. Those are layered over the stored
 * config and handed to the same pipeline.
 */

export async function POST(req: Request) {
  // Same role floor as PUT /api/ai-config — this route can be made to
  // send a live request with a caller-supplied API key, so it needs the
  // same 'owner' gate the config-save route has.
  let accountId: string
  try {
    accountId = (await requireRole('owner')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await req.json()
  const {
    message,
    history,
    contact_id,
    provider,
    api_key: rawKey,
    model,
    temperature,
    max_tokens,
    system_prompt,
    safety_filter,
    reply_language,
  } = body as {
    message?: string
    history?: Array<{ role: 'user' | 'model'; text: string }>
    /** Optional: preview as a specific contact, which is what makes the
     *  customer-scoped tools (their enquiries, their registrations)
     *  answer with anything. Without it those tools are not offered at
     *  all — the same as a conversation with no contact behind it. */
    contact_id?: string
    provider?: string
    api_key?: string
    model?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    safety_filter?: string
    reply_language?: string | null
  }

  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const providerId = provider || 'gemini'
  const adapter = PROVIDERS[providerId]
  if (!adapter) {
    return NextResponse.json({ error: `Unknown AI provider: ${providerId}` }, { status: 400 })
  }

  const stored = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  if (!stored) {
    return NextResponse.json({ error: 'Connect an AI provider first.' }, { status: 400 })
  }

  // An unsaved key is folded into a copy of the stored provider_keys, so
  // the pipeline resolves it by exactly the same route as a saved one
  // rather than needing a separate "test mode" path through the adapter.
  let providerKeys = stored.provider_keys
  if (rawKey?.trim()) {
    const keys = { ...(getProviderKeys(stored) as Record<string, unknown>) }
    keys[providerId] = {
      ...((keys[providerId] as Record<string, unknown>) ?? {}),
      // Re-encrypted because the pipeline decrypts whatever it finds
      // here; handing it plaintext would decrypt to nonsense.
      api_key: encrypt(rawKey.trim()),
      model: model || adapter.defaultModels[0]?.id || '',
    }
    providerKeys = keys as typeof stored.provider_keys
  } else {
    const entry = getProviderKeys(stored)[providerId]
    if (!entry?.api_key) {
      return NextResponse.json(
        { error: `No API key configured for ${adapter.label}. Save one first or enter one to test.` },
        { status: 400 },
      )
    }
    if (model && model !== entry.model) {
      const keys = { ...(getProviderKeys(stored) as Record<string, unknown>) }
      keys[providerId] = { ...(keys[providerId] as Record<string, unknown>), model }
      providerKeys = keys as typeof stored.provider_keys
    }
  }

  const aiConfig: CustomerAiConfig = {
    ...(stored as unknown as CustomerAiConfig),
    active_provider: providerId,
    provider_keys: providerKeys,
    temperature: temperature ?? stored.temperature,
    max_tokens: max_tokens ?? stored.max_tokens,
    safety_filter: safety_filter ?? stored.safety_filter,
    system_prompt: system_prompt !== undefined ? system_prompt : stored.system_prompt,
    reply_language: reply_language !== undefined ? reply_language : stored.reply_language,
  }

  // Only a contact of this account, so the preview cannot be pointed at
  // somebody else's customer to read their records.
  let contactId: string | null = null
  if (contact_id) {
    const owned = await prisma.contact.findFirst({
      where: { id: contact_id, account_id: accountId },
      select: { id: true },
    })
    contactId = owned?.id ?? null
  }

  const startedAt = Date.now()
  try {
    const turn = await runCustomerTurn({
      aiConfig,
      accountId,
      contactId,
      customerMessage: message.trim(),
      conversationHistory: Array.isArray(history)
        ? history
            .filter((h) => h && typeof h.text === 'string')
            .slice(-8)
            .map((h) => ({ role: h.role === 'user' ? ('user' as const) : ('model' as const), text: h.text }))
        : [],
      currentChannel: 'whatsapp',
    })

    void recordAiUsage({
      accountId,
      model: getProviderKeys(aiConfig)[providerId]?.model ?? 'unknown',
      feature: 'test',
      tokens: turn.usage ?? undefined,
      latencyMs: Date.now() - startedAt,
    })

    // A handoff is reported as a handoff. Showing the draft reply here
    // as though it were sent would preview an assistant that does not
    // exist — production would have sent the holding line instead and
    // put the conversation in front of a person.
    if (turn.decision.action === 'handoff') {
      return NextResponse.json({
        reply:
          turn.decision.reason === 'safety'
            ? turn.decision.safety?.customerMessage
            : stored.low_confidence_message?.trim() ||
              'Let me connect you with a team member who can help with that.',
        handoff: true,
        handoff_reason: turn.decision.reason,
        // The reply production suppressed, so the reason for the handoff
        // can be judged rather than guessed at.
        withheld_reply: turn.reply,
        retrieval_confidence: turn.effectiveConfidence,
        sources: turn.knowledgeUsed.slice(0, 6),
        tools_used: turn.toolsUsed,
      })
    }

    return NextResponse.json({
      reply: turn.decision.reply,
      truncated: turn.truncated,
      provider: providerId,
      handoff: false,
      retrieval_confidence: turn.effectiveConfidence,
      sources: turn.knowledgeUsed
        .filter((title, i, all) => title && all.indexOf(title) === i)
        .slice(0, 6),
      tools_used: turn.toolsUsed,
    })
  } catch (err) {
    void recordAiUsage({
      accountId,
      model: model ?? 'unknown',
      feature: 'test',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    })
    const classified = adapter.classifyError(err)
    return NextResponse.json({ error: classified.message }, { status: classified.retryable ? 429 : 400 })
  }
}
