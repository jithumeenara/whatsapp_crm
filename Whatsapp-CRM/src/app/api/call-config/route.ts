import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * Call settings for the account: whether the assistant answers, who a
 * call is transferred to, and the SIP credentials that are stored now
 * and used later.
 *
 * The SIP password follows the same rule as every other secret in this
 * app — written only when a new one is actually typed, never overwritten
 * by the mask the form shows back.
 */

const MASKED = '••••••••'

const DEFAULTS = {
  ai_answer_enabled: false,
  ai_greeting: null as string | null,
  ai_max_minutes: 10,
  transfer_strategy: 'least_busy',
  transfer_only_online: true,
  transfer_to: null as string | null,
  transfer_fallback_to: null as string | null,
  ring_seconds: 30,
  record_calls: false,
  sip_enabled: false,
  sip_host: null as string | null,
  sip_username: null as string | null,
  sip_from_number: null as string | null,
}

const TRANSFER_STRATEGIES = ['specific', 'least_busy', 'round_robin']

function present(config: Record<string, unknown> | null) {
  if (!config) return { ...DEFAULTS, has_sip_password: false, configured: false }
  const { sip_password, ...rest } = config
  return { ...rest, has_sip_password: Boolean(sip_password), configured: true }
}

export async function GET() {
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }
  const config = await prisma.callConfig.findUnique({ where: { account_id: accountId } })
  return NextResponse.json(present(config as unknown as Record<string, unknown> | null))
}

export async function PUT(request: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await prisma.callConfig.findUnique({ where: { account_id: accountId } })

  const strategy =
    typeof body.transfer_strategy === 'string' && TRANSFER_STRATEGIES.includes(body.transfer_strategy)
      ? body.transfer_strategy
      : (existing?.transfer_strategy ?? DEFAULTS.transfer_strategy)

  // Clamped rather than rejected: these come from a number input, and a
  // silently enormous value is a real problem (a caller left with an
  // assistant for an hour) rather than a validation nicety.
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }

  const pick = <T>(key: string, fallback: T): T =>
    body[key] !== undefined ? (body[key] as T) : fallback

  const data = {
    ai_answer_enabled: pick('ai_answer_enabled', existing?.ai_answer_enabled ?? false),
    ai_greeting: pick<string | null>('ai_greeting', existing?.ai_greeting ?? null),
    ai_max_minutes: clamp(
      body.ai_max_minutes,
      1,
      60,
      existing?.ai_max_minutes ?? DEFAULTS.ai_max_minutes,
    ),
    transfer_strategy: strategy,
    transfer_only_online: pick('transfer_only_online', existing?.transfer_only_online ?? true),
    transfer_to: pick<string | null>('transfer_to', existing?.transfer_to ?? null) || null,
    transfer_fallback_to:
      pick<string | null>('transfer_fallback_to', existing?.transfer_fallback_to ?? null) || null,
    ring_seconds: clamp(body.ring_seconds, 5, 120, existing?.ring_seconds ?? DEFAULTS.ring_seconds),
    record_calls: pick('record_calls', existing?.record_calls ?? false),
    sip_enabled: pick('sip_enabled', existing?.sip_enabled ?? false),
    sip_host: pick<string | null>('sip_host', existing?.sip_host ?? null) || null,
    sip_username: pick<string | null>('sip_username', existing?.sip_username ?? null) || null,
    sip_from_number:
      pick<string | null>('sip_from_number', existing?.sip_from_number ?? null) || null,
    // Only replaced when something new was actually typed. The form
    // shows a mask, and saving the form back must not store the mask.
    sip_password:
      typeof body.sip_password === 'string' && body.sip_password.trim() && body.sip_password !== MASKED
        ? encrypt(body.sip_password.trim())
        : (existing?.sip_password ?? null),
  }

  try {
    const saved = await prisma.callConfig.upsert({
      where: { account_id: accountId },
      create: { account_id: accountId, ...data },
      update: data,
    })
    return NextResponse.json(present(saved as unknown as Record<string, unknown>))
  } catch (err) {
    console.error('[PUT /api/call-config]', err)
    return NextResponse.json({ error: 'Could not save call settings.' }, { status: 500 })
  }
}
