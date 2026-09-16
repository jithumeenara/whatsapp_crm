import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * Where Meta sends a Flow's data requests, and whether that is still here.
 *
 * A Flow's endpoint URI lives on Meta, not in this database, and nothing in
 * the app had ever read it back. That is how a Flow came to be pointing at
 * a development ngrok tunnel that had long since been shut down: it passed
 * every test in Meta's own Flow Builder — the preview runs from the
 * developer's browser — and showed a blank screen to every real customer,
 * because a real call is made by Meta's servers to an address that no
 * longer existed. Nothing in the CRM could say so.
 *
 * GET reports what Meta currently has and what it ought to be.
 * POST sets it, so the fix is a button rather than a trip to Business
 * Manager and a URL typed by hand.
 */

/**
 * The address to register, taken from the request rather than from
 * NEXT_PUBLIC_APP_URL.
 *
 * The admin is reading this page over a hostname that demonstrably
 * works. The configured app URL is not always that hostname — on this
 * deployment the apex domain 301-redirects to the www host, and over
 * plain http at that, which a POST carrying an encrypted Flow payload
 * would not survive. Registering the host the browser actually used
 * avoids guessing which of a site's several names is the live one.
 */
function originOf(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost || request.headers.get('host')
  if (!host) return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

async function loadFlow(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized', status: 401 as const }

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return { error: 'Profile not linked to an account.', status: 403 as const }
  }

  const flow = await prisma.flow.findFirst({
    where: { id, account_id: profile.account_id, flow_type: 'whatsapp_flow' },
  })
  if (!flow) return { error: 'Flow not found', status: 404 as const }

  const cfg = flow.trigger_config as Record<string, unknown> | null
  const metaFlowId = cfg?.meta_flow_id as string | undefined
  if (!metaFlowId) {
    return {
      error: 'This flow has no Meta flow ID. Sync from Meta first.',
      status: 400 as const,
    }
  }

  const config = await resolveWhatsAppConfig({ accountId: profile.account_id }).catch(
    () => null,
  )
  if (!config) return { error: 'WhatsApp not configured.', status: 400 as const }

  return { flow, metaFlowId, accessToken: decrypt(config.access_token) }
}

/** Meta's error message if there is one, else a plain status line. */
async function metaError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error?.message) return body.error.message as string
  } catch {
    // Non-JSON error body — the status is all we have.
  }
  return `Meta API error: ${res.status}`
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const loaded = await loadFlow(id)
  if ('error' in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  }

  const expected = `${originOf(request)}/api/flows/${id}/webhook`

  const res = await fetch(
    `${META_API_BASE}/${loaded.metaFlowId}?fields=id,name,status,endpoint_uri`,
    { headers: { Authorization: `Bearer ${loaded.accessToken}` } },
  ).catch(() => null)

  if (!res || !res.ok) {
    return NextResponse.json(
      { error: res ? await metaError(res) : 'Could not reach Meta.' },
      { status: 502 },
    )
  }

  const body = (await res.json()) as {
    name?: string
    status?: string
    endpoint_uri?: string
  }
  const current = body.endpoint_uri ?? null

  return NextResponse.json({
    meta_flow_id: loaded.metaFlowId,
    meta_status: body.status ?? null,
    current,
    expected,
    // Compared exactly. A Flow endpoint that is merely *similar* — the
    // apex domain instead of www, http instead of https — is the kind of
    // near-miss that redirects away and fails silently.
    matches: current === expected,
  })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const loaded = await loadFlow(id)
  if ('error' in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  }

  const expected = `${originOf(request)}/api/flows/${id}/webhook`

  const res = await fetch(`${META_API_BASE}/${loaded.metaFlowId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loaded.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endpoint_uri: expected }),
  }).catch(() => null)

  if (!res || !res.ok) {
    return NextResponse.json(
      { error: res ? await metaError(res) : 'Could not reach Meta.' },
      { status: 502 },
    )
  }

  // Meta accepts the change against the draft. Until the Flow is
  // published again, customers keep getting the version that carries the
  // old address — so say so rather than reporting a fix that has not
  // reached anybody yet.
  return NextResponse.json({
    success: true,
    endpoint_uri: expected,
    needs_publish: true,
  })
}
