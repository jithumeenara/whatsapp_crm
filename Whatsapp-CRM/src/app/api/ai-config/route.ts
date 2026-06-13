import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

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

  return NextResponse.json({
    id: config.id,
    provider: config.provider,
    api_key_set: !!config.api_key,
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    system_prompt: config.system_prompt,
    training_data: config.training_data,
  })
}

export async function PUT(req: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await req.json()
  const { api_key, model, temperature, max_tokens, system_prompt, training_data } = body

  const existing = await prisma.aiConfig.findUnique({
    where: { account_id: guard.accountId },
  })

  let encryptedKey: string | undefined
  if (typeof api_key === 'string' && api_key.trim()) {
    encryptedKey = encrypt(api_key.trim())
  } else if (existing) {
    encryptedKey = existing.api_key
  } else {
    return NextResponse.json({ error: 'API key is required' }, { status: 400 })
  }

  const data = {
    provider: 'gemini',
    api_key: encryptedKey,
    model: model ?? 'gemini-2.0-flash',
    temperature: temperature != null ? Number(temperature) : 0.7,
    max_tokens: max_tokens != null ? Number(max_tokens) : 500,
    system_prompt: system_prompt ?? null,
    training_data: training_data ?? null,
  }

  const config = await prisma.aiConfig.upsert({
    where: { account_id: guard.accountId },
    update: data,
    create: {
      account_id: guard.accountId,
      user_id: guard.userId,
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
