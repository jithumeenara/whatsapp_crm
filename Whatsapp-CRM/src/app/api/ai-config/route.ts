import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys, type ProviderKeys } from '@/lib/ai/providers/registry'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncKnowledgeEmbeddings, toKnowledgeItems } from '@/lib/ai/embeddings'
import { chunkDocument, type QaPair, type KnowledgeDocument } from '@/lib/ai/knowledge'

// PUT/DELETE can rewrite this account's AI provider keys/base_url (a
// custom base_url is a live SSRF vector — see ssrf-guard.ts) or exfiltrate
// which providers are configured, so both require the 'owner' role,
// matching every other credentials-bearing settings route in this app
// (whatsapp/config/direct-send, whatsapp/payments/config, instagram/
// ice-breakers, etc.) — this route previously only checked that the
// caller was *any* authenticated member of the account, with no role
// floor at all.
async function requireUser(min: 'viewer' | 'owner' = 'owner') {
  try {
    const ctx = await requireRole(min)
    return { ok: true as const, userId: ctx.userId, accountId: ctx.accountId }
  } catch (err) {
    const res = toErrorResponse(err)
    const body = await res.json().catch(() => ({ error: 'Unauthorized' }))
    return { ok: false as const, status: res.status, body }
  }
}

export async function GET() {
  // Read-only status (has_key booleans, no secrets) — any account member
  // can view it, same as other Settings tabs' read paths.
  const guard = await requireUser('viewer')
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const config = await prisma.aiConfig.findUnique({
    where: { account_id: guard.accountId },
  })

  if (!config) {
    return NextResponse.json(null)
  }

  // Never return a key (encrypted or not) — just whether one is saved,
  // per-provider, so the Settings UI can show "Configured"/"Not
  // configured" tiles without ever handling ciphertext client-side.
  const keys = getProviderKeys(config)
  const providerStatus: Record<string, { model: string; base_url?: string; has_key: boolean }> = {}
  for (const [id, entry] of Object.entries(keys)) {
    providerStatus[id] = { model: entry.model, base_url: entry.base_url, has_key: !!entry.api_key }
  }

  return NextResponse.json({
    id: config.id,
    active_provider: config.active_provider,
    fallback_provider: config.fallback_provider,
    provider_keys: providerStatus,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    system_prompt: config.system_prompt,
    training_data: config.training_data,
    knowledge_documents: config.knowledge_documents,
    fallback_answer: config.fallback_answer,
    escalation_topics: config.escalation_topics,
    history_depth_default: config.history_depth_default,
    confidence_threshold: config.confidence_threshold,
    low_confidence_handoff_enabled: config.low_confidence_handoff_enabled,
    low_confidence_assign_to: config.low_confidence_assign_to,
    low_confidence_message: config.low_confidence_message,
    // Lets the Settings UI show "embeddings ready" vs "not set up yet"
    // (e.g. to explain why the Regenerate button matters) without
    // exposing anything sensitive — has_key above already covers that.
    semantic_search_available: !!keys.gemini?.api_key,
  })
}

interface ProviderKeyInput {
  /** A new plaintext key to save (encrypted here), or omitted/empty to
   *  keep whatever key is already stored for this provider — same
   *  "don't overwrite a secret unless a new value was actually typed"
   *  idiom this route already used for the single legacy Gemini key. */
  api_key?: string
  model?: string
  base_url?: string
}

export async function PUT(req: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await req.json()
  const {
    active_provider,
    fallback_provider,
    provider_keys,
    temperature,
    max_tokens,
    system_prompt,
    training_data,
    knowledge_documents,
    fallback_answer,
    escalation_topics,
    history_depth_default,
    confidence_threshold,
    low_confidence_handoff_enabled,
    low_confidence_assign_to,
    low_confidence_message,
  } = body as {
    active_provider?: string
    fallback_provider?: string | null
    provider_keys?: Record<string, ProviderKeyInput>
    temperature?: number
    max_tokens?: number
    system_prompt?: string | null
    training_data?: unknown
    knowledge_documents?: unknown
    fallback_answer?: string | null
    escalation_topics?: unknown
    history_depth_default?: number
    confidence_threshold?: number
    low_confidence_handoff_enabled?: boolean
    low_confidence_assign_to?: string | null
    low_confidence_message?: string | null
  }

  const existing = await prisma.aiConfig.findUnique({
    where: { account_id: guard.accountId },
  })
  const existingKeys = existing ? getProviderKeys(existing) : {}

  // Merge each submitted provider entry onto whatever's already stored —
  // a provider not mentioned in this PUT keeps its existing entry
  // untouched; a mentioned provider keeps its existing key unless a new
  // non-empty one was actually typed.
  const mergedKeys: ProviderKeys = { ...existingKeys }
  if (provider_keys && typeof provider_keys === 'object') {
    for (const [id, input] of Object.entries(provider_keys)) {
      const prior = existingKeys[id]
      const model = input.model ?? prior?.model
      if (!model) continue // can't save a provider entry with no model at all
      const apiKey =
        typeof input.api_key === 'string' && input.api_key.trim()
          ? encrypt(input.api_key.trim())
          : prior?.api_key
      if (!apiKey) continue // no key ever saved for this provider — nothing to store yet
      mergedKeys[id] = { api_key: apiKey, model, base_url: input.base_url ?? prior?.base_url }
    }
  }

  const resolvedActiveProvider = active_provider ?? existing?.active_provider ?? 'gemini'
  if (Object.keys(mergedKeys).length === 0) {
    return NextResponse.json({ error: 'Configure at least one AI provider with an API key first.' }, { status: 400 })
  }

  const data = {
    active_provider: resolvedActiveProvider,
    fallback_provider: fallback_provider === undefined ? existing?.fallback_provider ?? null : fallback_provider,
    provider_keys: mergedKeys as unknown as Prisma.InputJsonValue,
    temperature: temperature != null ? Number(temperature) : (existing?.temperature ?? 0.7),
    max_tokens: max_tokens != null ? Number(max_tokens) : (existing?.max_tokens ?? 500),
    system_prompt: system_prompt !== undefined ? system_prompt : (existing?.system_prompt ?? null),
    training_data:
      training_data !== undefined
        ? (training_data as Prisma.InputJsonValue)
        : ((existing?.training_data as Prisma.InputJsonValue | null) ?? Prisma.JsonNull),
    knowledge_documents: (knowledge_documents !== undefined
      ? knowledge_documents
      : (existing?.knowledge_documents ?? [])) as Prisma.InputJsonValue,
    fallback_answer: fallback_answer !== undefined ? fallback_answer : (existing?.fallback_answer ?? null),
    escalation_topics: (escalation_topics !== undefined
      ? escalation_topics
      : (existing?.escalation_topics ?? [])) as Prisma.InputJsonValue,
    history_depth_default:
      history_depth_default != null ? Number(history_depth_default) : (existing?.history_depth_default ?? 6),
    confidence_threshold:
      confidence_threshold != null ? Number(confidence_threshold) : (existing?.confidence_threshold ?? 0.35),
    low_confidence_handoff_enabled:
      low_confidence_handoff_enabled !== undefined
        ? low_confidence_handoff_enabled
        : (existing?.low_confidence_handoff_enabled ?? false),
    low_confidence_assign_to:
      low_confidence_assign_to !== undefined ? low_confidence_assign_to : (existing?.low_confidence_assign_to ?? null),
    low_confidence_message:
      low_confidence_message !== undefined ? low_confidence_message : (existing?.low_confidence_message ?? null),
  }

  const config = await prisma.aiConfig.upsert({
    where: { account_id: guard.accountId },
    update: data,
    create: {
      account_id: guard.accountId,
      user_id: guard.userId,
      // Legacy columns are NOT NULL / have defaults from the original
      // single-provider schema — satisfy them with harmless placeholders
      // since new code never reads these, only provider_keys above.
      provider: 'gemini',
      api_key: mergedKeys.gemini?.api_key ?? '',
      ...data,
    },
  })

  // Re-sync embeddings only when this save actually touched the
  // knowledge base (avoids extra DB round-trips on a save that just
  // changed e.g. temperature) and only when a Gemini key is on file —
  // an account with no Gemini key stays on keyword search, exactly as
  // if this feature didn't exist. Best-effort: a sync failure (bad key,
  // Gemini outage, etc.) never fails the config save itself — the
  // account's settings are already safely persisted above regardless.
  let embeddingsSync: { embedded: number; deleted: number; failed: number } | null = null
  const knowledgeBaseTouched = training_data !== undefined || knowledge_documents !== undefined
  const geminiApiKey = mergedKeys.gemini?.api_key ? decrypt(mergedKeys.gemini.api_key) : null
  if (knowledgeBaseTouched && geminiApiKey) {
    try {
      const qaPairs = Array.isArray(config.training_data) ? (config.training_data as unknown as QaPair[]) : []
      const documents = Array.isArray(config.knowledge_documents)
        ? (config.knowledge_documents as unknown as KnowledgeDocument[])
        : []
      const chunks = documents.flatMap((doc) => chunkDocument(doc))
      embeddingsSync = await syncKnowledgeEmbeddings({
        aiConfigId: config.id,
        apiKey: geminiApiKey,
        items: toKnowledgeItems(qaPairs, chunks),
      })
    } catch (err) {
      console.error('[ai-config] embedding sync failed (config itself still saved):', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true, id: config.id, embeddings_sync: embeddingsSync })
}

export async function DELETE() {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  await prisma.aiConfig.deleteMany({
    where: { account_id: guard.accountId },
  })

  return NextResponse.json({ success: true })
}
