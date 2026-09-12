import { NextResponse } from 'next/server'
import { TTS_VOICES } from '@/lib/ai/tts-voices'
import { CLOUD_VOICE_CHARACTERS } from '@/lib/ai/cloud-voices'
import { cloudTtsAvailable } from '@/lib/ai/cloud-tts'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys, type ProviderKeys } from '@/lib/ai/providers/registry'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

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
    reply_language: config.reply_language,
    safety_filter: config.safety_filter,
    knowledge_base_enabled: config.knowledge_base_enabled,
    retrieval_mode: config.retrieval_mode,
    max_context_results: config.max_context_results,
    auto_sync_website: config.auto_sync_website,
    admin_system_prompt: config.admin_system_prompt,
    customer_context_enabled: config.customer_context_enabled,
    response_validation_enabled: config.response_validation_enabled,
    composite_confidence_enabled: config.composite_confidence_enabled,
    voice_reply_enabled: config.voice_reply_enabled,
    voice_name: config.voice_name,
    voice_max_chars: config.voice_max_chars,
    cloud_voice: config.cloud_voice,
    live_voice_enabled: config.live_voice_enabled,
    live_voice_name: config.live_voice_name,
    // A server fact, not a per-account setting: whether this deployment
    // has Google Cloud credentials at all. The Settings screen uses it to
    // say which voice engine is really in use.
    cloud_tts_available: cloudTtsAvailable(),
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
    reply_language,
    safety_filter,
    knowledge_base_enabled,
    retrieval_mode,
    max_context_results,
    auto_sync_website,
    admin_system_prompt,
    customer_context_enabled,
    response_validation_enabled,
    composite_confidence_enabled,
    voice_reply_enabled,
    voice_name,
    voice_max_chars,
    cloud_voice,
    live_voice_enabled,
    live_voice_name,
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
    reply_language?: string | null
    safety_filter?: string
    knowledge_base_enabled?: boolean
    retrieval_mode?: string
    max_context_results?: number
    auto_sync_website?: boolean
    admin_system_prompt?: string | null
    customer_context_enabled?: boolean
    response_validation_enabled?: boolean
    composite_confidence_enabled?: boolean
    voice_reply_enabled?: boolean
    voice_name?: string
    voice_max_chars?: number
    cloud_voice?: string
    live_voice_enabled?: boolean
    live_voice_name?: string
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
    max_tokens: max_tokens != null ? Number(max_tokens) : (existing?.max_tokens ?? 2048),
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
    reply_language: reply_language !== undefined ? reply_language : (existing?.reply_language ?? null),
    // Only the three known values are accepted — an unrecognized string
    // would silently fall back to 'balanced' in the adapter anyway, so
    // reject it here rather than storing something misleading.
    safety_filter:
      safety_filter && ['strict', 'balanced', 'relaxed'].includes(safety_filter)
        ? safety_filter
        : (existing?.safety_filter ?? 'balanced'),
    knowledge_base_enabled:
      knowledge_base_enabled !== undefined
        ? knowledge_base_enabled
        : (existing?.knowledge_base_enabled ?? true),
    retrieval_mode:
      retrieval_mode && ['auto', 'semantic', 'keyword'].includes(retrieval_mode)
        ? retrieval_mode
        : (existing?.retrieval_mode ?? 'auto'),
    // Clamped rather than rejected — this is a UI slider/select value,
    // and a silently-huge context window is a real cost and accuracy
    // problem, not just a validation nicety.
    max_context_results:
      max_context_results != null
        ? Math.min(20, Math.max(1, Math.round(Number(max_context_results))))
        : (existing?.max_context_results ?? 5),
    auto_sync_website:
      auto_sync_website !== undefined ? auto_sync_website : (existing?.auto_sync_website ?? false),
    admin_system_prompt:
      admin_system_prompt !== undefined ? admin_system_prompt : (existing?.admin_system_prompt ?? null),
    customer_context_enabled:
      customer_context_enabled !== undefined
        ? customer_context_enabled
        : (existing?.customer_context_enabled ?? true),
    response_validation_enabled:
      response_validation_enabled !== undefined
        ? response_validation_enabled
        : (existing?.response_validation_enabled ?? true),
    composite_confidence_enabled:
      composite_confidence_enabled !== undefined
        ? composite_confidence_enabled
        : (existing?.composite_confidence_enabled ?? true),
    voice_reply_enabled:
      voice_reply_enabled !== undefined ? voice_reply_enabled : (existing?.voice_reply_enabled ?? true),
    // Only a name the API actually accepts — an unknown voice is
    // rejected by Gemini at send time, which would turn every voice
    // reply into a silent fallback to text.
    voice_name:
      voice_name && TTS_VOICES.some((v) => v.id === voice_name)
        ? voice_name
        : (existing?.voice_name ?? 'Kore'),
    voice_max_chars:
      voice_max_chars !== undefined
        ? Math.min(4000, Math.max(100, Number(voice_max_chars)))
        : (existing?.voice_max_chars ?? 700),
    cloud_voice:
      cloud_voice && CLOUD_VOICE_CHARACTERS.some((v) => v.id === cloud_voice)
        ? cloud_voice
        : (existing?.cloud_voice ?? 'Achernar'),
    live_voice_enabled:
      live_voice_enabled !== undefined ? live_voice_enabled : (existing?.live_voice_enabled ?? false),
    live_voice_name:
      live_voice_name && TTS_VOICES.some((v) => v.id === live_voice_name)
        ? live_voice_name
        : (existing?.live_voice_name ?? 'Kore'),
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

  // Embedding/training deliberately does NOT happen here any more.
  //
  // It used to be triggered by this route seeing training_data or
  // knowledge_documents in the body, but the knowledge base moved to
  // its own table (migration 068) and nothing sends those fields now —
  // leaving the branch in place meant a block of code whose comment
  // claimed it kept embeddings fresh while it could never actually run.
  // Training is one explicit action instead: POST /api/ai-knowledge/sync,
  // behind the Training tab's "Train now".

  return NextResponse.json({ success: true, id: config.id })
}

export async function DELETE() {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  await prisma.aiConfig.deleteMany({
    where: { account_id: guard.accountId },
  })

  return NextResponse.json({ success: true })
}
