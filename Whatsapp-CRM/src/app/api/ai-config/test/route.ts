import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { PROVIDERS, generateAiReply, getProviderKeys } from '@/lib/ai/providers/registry'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { markdownToWhatsApp } from '@/lib/whatsapp/markdown-to-whatsapp'
import { loadKnowledge } from '@/lib/ai/knowledge-store'
import { loadCompanyProfile, formatCompanyBlock } from '@/lib/ai/company-profile'
import { recordAiUsage } from '@/lib/ai/usage'
import { selectRelevantContext, formatKnowledgeBlock } from '@/lib/ai/knowledge'

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
    safety_filter,
    reply_language,
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

  // Knowledge: when the caller doesn't pass its own training_data, this
  // runs the SAME retrieval the real ai_reply node runs — load the
  // account's knowledge items, rank them against this message, and fold
  // only the relevant ones into the prompt. Previously the test screen
  // flattened a client-supplied copy of the Q&A pairs and ignored
  // documents entirely, so it could answer better or worse than
  // production for reasons that had nothing to do with the model. A
  // preview that doesn't match what customers get isn't a preview.
  let knowledgeBlock = ''
  let retrievalConfidence: number | null = null
  if (!training_data) {
    const storedConfig = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
    if (storedConfig?.knowledge_base_enabled) {
      try {
        // Customer Test mirrors the real customer path exactly,
        // including the audience boundary — a preview that could see
        // staff-only entries would not be a preview.
        const { qaPairs, documents, version } = await loadKnowledge(storedConfig.id, 'customer')
        if (qaPairs.length > 0 || documents.length > 0) {
          const geminiEntry = getProviderKeys(storedConfig).gemini
          const geminiApiKey = geminiEntry?.api_key ? decrypt(geminiEntry.api_key) : null
          const useSemantic = storedConfig.retrieval_mode !== 'keyword' && !!geminiApiKey
          const limit = Math.max(1, storedConfig.max_context_results)
          const selected = await selectRelevantContext(message.trim(), qaPairs, documents, {
            cacheKey: `${storedConfig.id}:${version}`,
            maxQaPairs: limit,
            maxDocChunks: limit,
            ...(useSemantic ? { semantic: { aiConfigId: storedConfig.id, geminiApiKey: geminiApiKey! } } : {}),
          })
          knowledgeBlock = formatKnowledgeBlock(selected)
          retrievalConfidence = selected.confidence
        }
      } catch (err) {
        // Retrieval is an enhancement here, not the point of the test —
        // a failure still gets a reply, just without grounding.
        console.error('[ai-config/test] knowledge retrieval failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  // Same company block the live reply path prepends, so the preview is
  // grounded in the same identity a customer would get.
  const companyProfile = await loadCompanyProfile(accountId).catch(() => null)
  const systemPrompt = buildTestSystemPrompt(
    system_prompt,
    training_data,
    reply_language,
    knowledgeBlock,
    formatCompanyBlock(companyProfile, 'customer'),
  )

  const startedAt = Date.now()
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
        safetyFilter: safety_filter,
      },
      message.trim(),
    )
    void recordAiUsage({
      accountId,
      model: resolvedModel,
      feature: 'test',
      tokens: result.usage,
      latencyMs: Date.now() - startedAt,
    })
    // Converted the same way a real send is (engine.ts's ai_reply node) —
    // this screen is meant to preview what a customer actually receives,
    // so it needs to show the same WhatsApp-formatted text, not raw
    // Markdown that only looks fine here and breaks on a real send.
    return NextResponse.json({
      reply: markdownToWhatsApp(result.text),
      truncated: result.truncated,
      provider: providerId,
      // Lets the Test AI screen show what the bot actually retrieved for
      // this message — the same number the confidence-handoff guardrail
      // compares against in production.
      retrieval_confidence: retrievalConfidence,
    })
  } catch (err) {
    // Failures are recorded too — a run of errors in the Usage tab is
    // exactly what someone debugging a key or quota needs to see.
    void recordAiUsage({
      accountId,
      model: resolvedModel,
      feature: 'test',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    })
    const classified = adapter.classifyError(err)
    return NextResponse.json({ error: classified.message }, { status: classified.retryable ? 429 : 400 })
  }
}

function buildTestSystemPrompt(
  systemPrompt: string | undefined,
  trainingData: Array<{ question: string; answer: string }> | undefined,
  replyLanguage?: string | null,
  knowledgeBlock?: string,
  companyBlock?: string,
): string {
  const parts: string[] = []
  if (companyBlock) parts.push(companyBlock)
  if (systemPrompt) parts.push(systemPrompt)
  if (knowledgeBlock) parts.push(knowledgeBlock)
  // Same instruction the real ai_reply node adds (engine.ts) — this
  // screen is a preview of production behavior, so it has to apply the
  // same language rule rather than diverging from it.
  if (replyLanguage) {
    parts.push(`Always reply in ${replyLanguage}, regardless of which language the customer writes in.`)
  }
  if (trainingData && trainingData.length > 0) {
    parts.push('Knowledge base (use these to answer questions accurately):')
    for (const item of trainingData) {
      if (item.question && item.answer) parts.push(`Q: ${item.question}\nA: ${item.answer}`)
    }
  }
  return parts.join('\n\n') || 'You are a helpful assistant.'
}
