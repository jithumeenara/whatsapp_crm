import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { generateWebhookSecret, validateWebhookUrl, WEBHOOK_EVENTS } from '@/lib/webhooks/deliver'

async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized.' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  return { ok: true as const, accountId: profile.account_id }
}

export async function GET() {
  try {
    const guard = await requireSession()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const webhooks = await prisma.webhook.findMany({
      where: { account_id: guard.accountId },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        table_id: true,
        is_active: true,
        last_triggered_at: true,
        last_response_status: true,
        failure_count: true,
        created_at: true,
        // Never return signing_secret in list responses
        table: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ webhooks })
  } catch (err) {
    console.error('[GET /api/webhooks]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSession()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })

    const name = body.name?.trim()
    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (name.length > 80) return NextResponse.json({ error: 'name too long.' }, { status: 400 })

    // URL validation with SSRF guard
    let url: string
    try {
      url = validateWebhookUrl(body.url ?? '')
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }

    // Validate events
    const events: string[] = Array.isArray(body.events) ? body.events : []
    const invalid = events.filter((e) => !(WEBHOOK_EVENTS as string[]).includes(e))
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Unknown event(s): ${invalid.join(', ')}` }, { status: 400 })
    }
    if (events.length === 0) {
      return NextResponse.json({ error: 'At least one event is required.' }, { status: 400 })
    }

    // Optional table scope
    let tableId: string | null = null
    if (body.table_id) {
      const table = await prisma.dataTable.findFirst({
        where: { id: body.table_id, account_id: guard.accountId },
        select: { id: true },
      })
      if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 400 })
      tableId = table.id
    }

    const signingSecret = generateWebhookSecret()

    const webhook = await prisma.webhook.create({
      data: {
        account_id: guard.accountId,
        name,
        url,
        signing_secret: signingSecret,
        events,
        table_id: tableId,
      },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        table_id: true,
        is_active: true,
        created_at: true,
      },
    })

    // Return signing_secret ONLY on creation — never again
    return NextResponse.json({ webhook, signing_secret: signingSecret }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/webhooks]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
