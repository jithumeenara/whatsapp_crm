import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys, type ProviderKeys } from '@/lib/ai/providers/registry'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return { ok: false as const, status: 403, body: { error: 'Profile not linked to an account.' } }
  }
  return { ok: true as const, userId: session.user.id, accountId: profile.account_id }
}

export async function GET() {
  const guard = await requireUser()
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
