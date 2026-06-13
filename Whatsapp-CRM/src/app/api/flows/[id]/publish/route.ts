import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * POST /api/flows/[id]/publish
 *
 * Publishes a whatsapp_flow to Meta. The flow must have a meta_flow_id
 * in trigger_config (i.e. it was synced from or created on Meta).
 * After a successful publish, the local status is updated to "active".
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 })
    }

    const flow = await prisma.flow.findFirst({
      where: { id, account_id: profile.account_id, flow_type: 'whatsapp_flow' },
    })
    if (!flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    const cfg = flow.trigger_config as Record<string, unknown>
    const metaFlowId = cfg?.meta_flow_id as string | undefined
    if (!metaFlowId) {
      return NextResponse.json(
        { error: 'This flow has no Meta flow ID. Sync from Meta first.' },
        { status: 400 },
      )
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: profile.account_id },
    })
    if (!config) {
      return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })
    }

    const accessToken = decrypt(config.access_token)

    const metaRes = await fetch(`${META_API_BASE}/${metaFlowId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!metaRes.ok) {
      let errMsg = `Meta API error: ${metaRes.status}`
      try {
        const body = await metaRes.json()
        if (body?.error?.message) errMsg = body.error.message
      } catch { /* non-JSON */ }
      return NextResponse.json({ error: errMsg }, { status: 502 })
    }

    await prisma.flow.update({
      where: { id },
      data: { status: 'active' },
    })

    return NextResponse.json({ ok: true, status: 'active' })
  } catch (err) {
    console.error('[POST /api/flows/[id]/publish]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
