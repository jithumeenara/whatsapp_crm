import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'
import { ensureFacebookConfigTable, ensureInstagramConfigTable } from '@/lib/social/ensure-tables'
import { appSecretProof } from '@/lib/meta/connect-state'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { isFacebookToken } from '@/lib/meta/social-messaging'
import { featuresFor, hintsFor, type SocialChannelKey } from '@/lib/meta/social-features'
import { tokenInfo, unsubscribeWebhooks, type MetaApp } from '@/lib/meta/social-connect'
import { loadMetaAppOnly, socialConnectReady } from '@/lib/meta/social-connect-server'

type Row = {
  access_token: string | null
  status: string | null
  connected_via: string | null
  token_kind: string | null
  granted_permissions: unknown
  token_expires_at: Date | null
  name: string | null
  id: string | null
  human_agent_enabled: boolean | null
}

async function rowFor(channel: SocialChannelKey, accountId: string): Promise<Row | null> {
  if (channel === 'facebook') {
    await ensureFacebookConfigTable()
    const r = await prisma.$queryRaw<Row[]>`
      SELECT access_token, status, connected_via, token_kind, granted_permissions, token_expires_at,
             page_name AS name, page_id AS id, human_agent_enabled
      FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1`
    return r[0] ?? null
  }
  await ensureInstagramConfigTable()
  const r = await prisma.$queryRaw<Row[]>`
    SELECT access_token, status, connected_via, token_kind, granted_permissions, token_expires_at,
           COALESCE(ig_username, ig_name) AS name, instagram_account_id AS id, human_agent_enabled
    FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1`
  return r[0] ?? null
}

/** Which webhook fields Meta has on file for this Page / Instagram account. */
async function subscribedFields(id: string, token: string, app: MetaApp): Promise<string[] | null> {
  if (!/^\d{1,30}$/.test(id) || !isFacebookToken(token)) return null
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${id}/subscribed_apps`)
  url.searchParams.set('access_token', token)
  url.searchParams.set('appsecret_proof', appSecretProof(token, app.appSecret))
  const res = await fetch(url.toString(), { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string; subscribed_fields?: string[] }> }
  const mine = (body.data ?? []).find((d) => d.id === app.appId) ?? body.data?.[0]
  return Array.isArray(mine?.subscribed_fields) ? mine.subscribed_fields : []
}

async function statusFor(channel: SocialChannelKey, accountId: string, app: MetaApp | null) {
  const row = await rowFor(channel, accountId)
  const token = openStoredSecret(row?.access_token ?? null)
  const connected = Boolean(token && row?.status === 'connected')
  let scopes: string[] | null = Array.isArray(row?.granted_permissions) ? (row?.granted_permissions as string[]) : null
  let tokenValid: boolean | null = null
  let webhookFields: string[] | null = null
  if (connected && token && app && isFacebookToken(token)) {
    const info = await tokenInfo(token, app).catch(() => null)
    if (info) {
      tokenValid = info.valid
      if (info.scopes.length) scopes = info.scopes
    }
    if (row?.id) webhookFields = await subscribedFields(row.id, token, app)
  }
  const features = featuresFor(channel, scopes)
  return {
    connected,
    name: row?.name ?? null,
    via: row?.connected_via ?? null,
    tokenKind: row?.token_kind ?? null,
    expiresAt: row?.token_expires_at ?? null,
    humanAgent: row?.human_agent_enabled === true,
    tokenValid,
    features,
    webhookFields,
    hints: hintsFor(channel, { connected, tokenValid, features, webhookFields }),
  }
}

/** GET /api/meta/social-connect — what is connected and what works, for Settings. */
export async function GET() {
  try {
    const ctx = await requireRole('owner')
    const app = await loadMetaAppOnly()
    const [ready, facebook, instagram] = await Promise.all([socialConnectReady(), statusFor('facebook', ctx.accountId, app), statusFor('instagram', ctx.accountId, app)])
    // Each card shows its own button only when its configuration is set.
    return NextResponse.json({ oneClickReady: ready.instagram || ready.facebook, oneClick: ready, facebook, instagram })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/meta/social-connect — body { channel, human_agent }: turn Human
 * agent replies (7 days, HUMAN_AGENT tag) on or off. Only meant once Meta
 * has approved the Human Agent feature for the app; Meta refuses tagged
 * sends otherwise.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { channel?: unknown; human_agent?: unknown } | null
    const channel = body?.channel === 'facebook' || body?.channel === 'instagram' ? body.channel : null
    if (!channel || typeof body?.human_agent !== 'boolean') return NextResponse.json({ error: 'Send channel and human_agent (true or false).' }, { status: 400 })
    if (channel === 'facebook') {
      await ensureFacebookConfigTable()
      await prisma.$executeRaw`UPDATE facebook_config SET human_agent_enabled = ${body.human_agent}, updated_at = now() WHERE account_id = ${ctx.accountId}::uuid`
    } else {
      await ensureInstagramConfigTable()
      await prisma.$executeRaw`UPDATE instagram_config SET human_agent_enabled = ${body.human_agent}, updated_at = now() WHERE account_id = ${ctx.accountId}::uuid`
    }
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: `${channel}_human_agent`, fields: ['human_agent_enabled'], meta: { on: body.human_agent } })
    return NextResponse.json({ ok: true, human_agent: body.human_agent })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/meta/social-connect — body { channel }: stop Meta sending
 * webhooks for it and remove the token. Messages, contacts and settings stay.
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { channel?: unknown } | null
    const channel = body?.channel === 'facebook' || body?.channel === 'instagram' ? body.channel : null
    if (!channel) return NextResponse.json({ error: 'Choose facebook or instagram.' }, { status: 400 })
    const row = await rowFor(channel, ctx.accountId)
    const token = openStoredSecret(row?.access_token ?? null)
    const app = await loadMetaAppOnly()
    if (token && row?.id && app && isFacebookToken(token)) await unsubscribeWebhooks(row.id, token, app)
    if (channel === 'facebook') {
      await prisma.$executeRaw`UPDATE facebook_config SET access_token = NULL, status = 'disconnected', granted_permissions = NULL, updated_at = now() WHERE account_id = ${ctx.accountId}::uuid`
    } else {
      await prisma.$executeRaw`UPDATE instagram_config SET access_token = NULL, status = 'disconnected', granted_permissions = NULL, updated_at = now() WHERE account_id = ${ctx.accountId}::uuid`
    }
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: `${channel}_connection`, fields: ['access_token', 'status'], meta: { step: 'disconnected' } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
