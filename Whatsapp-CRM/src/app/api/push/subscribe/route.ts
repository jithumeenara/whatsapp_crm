import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

interface PushSubscriptionBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const body = await req.json() as PushSubscriptionBody
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    }

    const userAgent = req.headers.get('user-agent') ?? null

    await prisma.pushSubscription.upsert({
      where: { user_id_endpoint: { user_id: ctx.userId, endpoint: body.endpoint } },
      create: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: userAgent,
      },
      update: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: userAgent,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const body = await req.json().catch(() => null) as { endpoint?: string } | null
    if (!body?.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

    await prisma.pushSubscription.deleteMany({
      where: { user_id: ctx.userId, endpoint: body.endpoint },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
