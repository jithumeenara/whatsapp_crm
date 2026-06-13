import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * GET /api/flows/[id]/screens
 *
 * Returns the screen IDs for a whatsapp_flow. Tries the local
 * trigger_config first (if the full flow JSON was saved), then falls
 * back to fetching from Meta's Graph API.
 */
export async function GET(
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

    // If the full Meta flow JSON is stored locally (screens array present), use it
    if (Array.isArray(cfg?.screens)) {
      const screens = (cfg.screens as Array<{ id: string }>).map((s) => s.id)
      return NextResponse.json({ screens })
    }

    const metaFlowId = cfg?.meta_flow_id as string | undefined
    if (!metaFlowId) {
      return NextResponse.json({ screens: [] })
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: profile.account_id },
    })
    if (!config) {
      return NextResponse.json({ screens: [] })
    }

    const accessToken = decrypt(config.access_token)

    const metaRes = await fetch(
      `${META_API_BASE}/${metaFlowId}?fields=id,name,screens{id,title}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!metaRes.ok) {
      return NextResponse.json({ screens: [] })
    }

    const body = await metaRes.json() as {
      screens?: Array<{ id: string; title?: string }>
    }
    const screens = (body.screens ?? []).map((s) => s.id)
    return NextResponse.json({ screens })
  } catch (err) {
    console.error('[GET /api/flows/[id]/screens]', err)
    return NextResponse.json({ screens: [] })
  }
}
