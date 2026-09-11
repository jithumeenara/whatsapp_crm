import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { PROVIDERS, generateAiReply, getProviderKeys } from '@/lib/ai/providers/registry'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { markdownToWhatsApp } from '@/lib/whatsapp/markdown-to-whatsapp'

export async function POST(req: Request) {
  // Same role floor as PUT /api/ai-config — this route can be made to
  // send a live request (with this account's real or a caller-supplied
  // API key) to any base_url the caller names, so it needs the same
  // 'owner' gate the config-save route has, not just "any authenticated
  // account member."
  let accountId: string
  try {
    accountId = (await requireRole('owner')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await req.json()
  const {
    message,
    provider,
    api_key: rawKey,
    model,
    base_url,
    temperature,
    max_tokens,
    system_prompt,
    training_data,
  } = body as {
    message?: string
    provider?: string
    api_key?: string
    model?: string
    base_url?: string
    temperature?: number
    max_tokens?: number
    system_prompt?: string
    training_data?: Array<{ question: string; answer: string }>
  }

  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const providerId = provider || 'gemini'
  const adapter = PROVIDERS[providerId]
  if (!adapter) {
    return NextResponse.json({ error: `Unknown AI provider: ${providerId}` }, { status: 400 })
  }

  // Resolve API key/model: prefer what was sent in the request body
  // (unsaved — this is what makes "test before you save" possible), fall
  // back to this provider's already-saved, decrypted key.
  let apiKey: string
  let resolvedModel: string
  if (rawKey?.trim()) {
    apiKey = rawKey.trim()
    resolvedModel = model || adapter.defaultModels[0]?.id || ''
  } else {
    const stored = await prisma.aiConfig.findUnique({
      where: { account_id: accountId },
    })
    const entry = stored ? getProviderKeys(stored)[providerId] : undefined
    if (!entry?.api_key) {
      return NextResponse.json(
        { error: `No API key configured for ${adapter.label}. Save one first or enter one to test.` },
        { status: 400 },
      )
    }
    apiKey = decrypt(entry.api_key)
    resolvedModel = model || entry.model
  }

  if (!resolvedModel) {
    return NextResponse.json({ error: 'A model is required for this provider.' }, { status: 400 })
  }

  // Same flattening the old Gemini-only implementation used — training
  // data folded into the system prompt, unfiltered here since this is a
  // manual one-off test message, not a real conversation turn (the real
  // ai_reply node applies relevance filtering, see src/lib/ai/knowledge.ts).
  const systemPrompt = buildTestSystemPrompt(system_prompt, training_data)

  try {
    const result = await generateAiReply(
      providerId,
      {
        apiKey,
        model: resolvedModel,
        baseUrl: base_url || (providerId === 'deepseek' ? 'https://api.deepseek.com' : undefined),
        temperature: temperature ?? 0.7,
        maxTokens: max_tokens ?? 500,
        systemPrompt,
      },
      message.trim(),
    )
    // Converted the same way a real send is (engine.ts's ai_reply node) —
    // this screen is meant to preview what a customer actually receives,
    // so it needs to show the same WhatsApp-formatted text, not raw
    // Markdown that only looks fine here and breaks on a real send.
    return NextResponse.json({ reply: markdownToWhatsApp(result.text), truncated: result.truncated, provider: providerId })
  } catch (err) {
    const classified = adapter.classifyError(err)
    return NextResponse.json({ error: classified.message }, { status: classified.retryable ? 429 : 400 })
  }
}

function buildTestSystemPrompt(
  systemPrompt: string | undefined,
  trainingData: Array<{ question: string; answer: string }> | undefined,
): string {
  const parts: string[] = []
  if (systemPrompt) parts.push(systemPrompt)
  if (trainingData && trainingData.length > 0) {
    parts.push('Knowledge base (use these to answer questions accurately):')
    for (const item of trainingData) {
      if (item.question && item.answer) parts.push(`Q: ${item.question}\nA: ${item.answer}`)
    }
  }
  return parts.join('\n\n') || 'You are a helpful assistant.'
}
