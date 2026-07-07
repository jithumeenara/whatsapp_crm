import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { getChatbotTemplate } from '@/lib/chatbot/templates'

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

async function ensureChannelColumn() {
  await prisma.$executeRaw`
    ALTER TABLE flows ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
  `.catch(() => {})
}

/** GET /api/chatbot — list all chatbots for the caller's account */
export async function GET() {
  try {
    const guard = await requireUser()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await ensureChannelColumn()

    const chatbots = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, account_id, user_id, name, description, flow_type, channel,
             status, trigger_type, trigger_config, entry_node_id,
             execution_count, last_executed_at, created_at, updated_at,
             CASE WHEN status = 'active' THEN true ELSE false END AS is_active
      FROM flows
      WHERE account_id = ${guard.accountId}::uuid AND flow_type = 'chatbot'
      ORDER BY created_at DESC
    `
    return NextResponse.json({ chatbots })
  } catch (err) {
    console.error('[GET /api/chatbot]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/chatbot — create a new chatbot (optionally from a template) */
export async function POST(request: Request) {
  try {
    const guard = await requireUser()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
    const { userId, accountId } = guard

    await ensureChannelColumn()

    const body = await request.json().catch(() => null) as {
      name?: string
      description?: string | null
      trigger_type?: string
      trigger_config?: Record<string, unknown>
      template_slug?: string
      channel?: string
    } | null

    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    // ── Template clone path ──────────────────────────────────────
    if (body.template_slug) {
      const tpl = getChatbotTemplate(body.template_slug)
      if (!tpl) {
        return NextResponse.json({ error: `Unknown template "${body.template_slug}"` }, { status: 400 })
      }

      const channel = body.channel ?? 'whatsapp'
      const chatbot = await prisma.flow.create({
        data: {
          account_id: accountId,
          user_id: userId,
          flow_type: 'chatbot',
          name: body.name ?? tpl.name,
          description: body.description ?? tpl.description,
          trigger_type: tpl.trigger_type,
          trigger_config: tpl.trigger_config as Prisma.InputJsonValue,
          entry_node_id: tpl.entry_node_id,
          status: 'draft',
          nodes: {
            create: tpl.nodes.map((n) => ({
              node_key: n.node_key,
              node_type: n.node_type,
              config: n.config as Prisma.InputJsonValue,
              position_x: n.position_x,
              position_y: n.position_y,
            })),
          },
        },
      })
      await prisma.$executeRaw`UPDATE flows SET channel = ${channel} WHERE id = ${chatbot.id}::uuid`
      return NextResponse.json({ chatbot: { ...chatbot, channel } }, { status: 201 })
    }

    // ── Blank chatbot path ───────────────────────────────────────
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const channel = body.channel ?? 'whatsapp'
    const chatbot = await prisma.flow.create({
      data: {
        account_id: accountId,
        user_id: userId,
        flow_type: 'chatbot',
        name: body.name.trim(),
        description: body.description ?? null,
        trigger_type: body.trigger_type ?? 'always',
        trigger_config: (body.trigger_config ?? {}) as Prisma.InputJsonValue,
        status: 'draft',
        nodes: {
          create: [
            {
              node_key: 'start',
              node_type: 'start',
              config: { next_node_key: '' } as Prisma.InputJsonValue,
              position_x: 320,
              position_y: 80,
            },
          ],
        },
        entry_node_id: 'start',
      },
    })
    await prisma.$executeRaw`UPDATE flows SET channel = ${channel} WHERE id = ${chatbot.id}::uuid`
    return NextResponse.json({ chatbot: { ...chatbot, channel } }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/chatbot]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
