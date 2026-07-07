import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { validateWebhookUrl, WEBHOOK_EVENTS } from '@/lib/webhooks/deliver'

async function requireWebhook(webhookId: string) {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized.' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  const hook = await prisma.webhook.findFirst({
    where: { id: webhookId, account_id: profile.account_id },
    select: { id: true },
  })
  if (!hook) return { ok: false as const, status: 404, body: { error: 'Webhook not found.' } }
  return { ok: true as const, accountId: profile.account_id }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const guard = await requireWebhook(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })

    const updates: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 })
      if (name.length > 80) return NextResponse.json({ error: 'name too long.' }, { status: 400 })
      updates.name = name
    }

    if (body.url !== undefined) {
      try {
        updates.url = validateWebhookUrl(body.url)
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 })
      }
    }

    if (body.events !== undefined) {
      const events: string[] = Array.isArray(body.events) ? body.events : []
      const invalid = events.filter((e) => !(WEBHOOK_EVENTS as string[]).includes(e))
      if (invalid.length > 0) {
        return NextResponse.json({ error: `Unknown event(s): ${invalid.join(', ')}` }, { status: 400 })
      }
      if (events.length === 0) {
        return NextResponse.json({ error: 'At least one event is required.' }, { status: 400 })
      }
      updates.events = events
    }

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active)
      // Reset failure count when re-enabling
      if (body.is_active === true) updates.failure_count = 0
    }

    if (body.table_id !== undefined) {
      if (body.table_id === null) {
        updates.table_id = null
      } else {
        const table = await prisma.dataTable.findFirst({
          where: { id: body.table_id, account_id: guard.accountId },
          select: { id: true },
        })
        if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 400 })
        updates.table_id = table.id
      }
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        table_id: true,
        is_active: true,
        failure_count: true,
        last_triggered_at: true,
        last_response_status: true,
        created_at: true,
        updated_at: true,
      },
    })
    return NextResponse.json({ webhook })
  } catch (err) {
    console.error('[PUT /api/webhooks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const guard = await requireWebhook(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.webhook.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/webhooks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
