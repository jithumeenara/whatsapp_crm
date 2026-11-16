/**
 * "Connect Facebook & Instagram" — the server side of the one-click flow.
 *
 * Meta (Nov 2026): Facebook Login for Business with a configuration
 * (`config_id`) returns a Business Integration System User token that
 * "defaults to never expire" and belongs to the customer's business
 * portfolio. With it we list the Pages (each with its own Page token, which
 * the Messenger Send API needs) and the Instagram professional accounts
 * shared with the app (Unified Login: graph.facebook.com/{ig-id}), subscribe
 * each to our webhooks, and save them for this workspace only.
 *
 * Every Graph call carries appsecret_proof. Tokens are sealed before they
 * touch the database and never leave the server.
 */

import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { sealSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from './versions'
import { appSecretProof } from './connect-state'
import { ensureFacebookConfigTable, ensureInstagramConfigTable } from '@/lib/social/ensure-tables'

const FB = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const NUMERIC_ID = /^\d{1,30}$/

export interface MetaApp { appId: string; appSecret: string }

/** Webhook fields subscribed for a Page (Messenger + comments + Lead Ads). */
export const PAGE_WEBHOOK_FIELDS = [
  'messages', 'messaging_postbacks', 'message_echoes', 'message_reactions', 'message_reads',
  'message_deliveries', 'message_edits', 'messaging_referrals', 'messaging_optins',
  'messaging_handovers', 'standby', 'feed', 'leadgen',
] as const
/** Webhook fields subscribed for an Instagram professional account (Unified Login). */
export const INSTAGRAM_WEBHOOK_FIELDS = [
  'messages', 'messaging_postbacks', 'messaging_seen', 'message_reactions', 'message_edit',
  'messaging_referral', 'comments', 'live_comments', 'mentions', 'story_insights',
] as const

type MetaError = { message?: string; code?: number; error_subcode?: number }
type Json = Record<string, unknown>

async function graph(method: 'GET' | 'POST' | 'DELETE', path: string, token: string, app: MetaApp, params: Record<string, string> = {}): Promise<{ ok: boolean; data: Json; error?: MetaError }> {
  const url = new URL(`${FB}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('access_token', token)
  url.searchParams.set('appsecret_proof', appSecretProof(token, app.appSecret))
  const res = await fetch(url.toString(), { method, cache: 'no-store' })
  const data = (await res.json().catch(() => ({}))) as Json & { error?: MetaError }
  if (!res.ok || data.error) return { ok: false, data, error: data.error ?? { message: `HTTP ${res.status}` } }
  return { ok: true, data }
}

/** The authorization code → the customer's token. Server side only. */
export async function exchangeCode(code: string, redirectUri: string, app: MetaApp): Promise<string> {
  if (!/^[\w\-.#~]{10,2048}$/.test(code)) throw new Error('Meta returned an unexpected code. Start again.')
  const url = new URL(`${FB}/oauth/access_token`)
  url.searchParams.set('client_id', app.appId)
  url.searchParams.set('client_secret', app.appSecret)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code', code.replace(/#_$/, ''))
  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: MetaError }
  if (!res.ok || !data.access_token) {
    console.error('[meta connect] code exchange failed:', res.status, data.error?.code, data.error?.message)
    throw new Error('Meta did not finish the connection (the link may have expired). Press Connect again.')
  }
  return data.access_token
}

/** What the token may do and until when (debug_token, with the app token). */
export async function tokenInfo(token: string, app: MetaApp): Promise<{ valid: boolean; scopes: string[]; expiresAt: Date | null }> {
  const url = new URL(`${FB}/debug_token`)
  url.searchParams.set('input_token', token)
  url.searchParams.set('access_token', `${app.appId}|${app.appSecret}`)
  const res = await fetch(url.toString(), { cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as { data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number } }
  const d = body.data ?? {}
  const exp = typeof d.expires_at === 'number' && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null
  return { valid: d.is_valid === true, scopes: Array.isArray(d.scopes) ? d.scopes.filter((s) => typeof s === 'string') : [], expiresAt: exp }
}

export interface PageAsset { id: string; name: string; token: string; igId: string | null }
export interface InstagramAsset { id: string; username: string | null; name: string | null }

/** The Pages and Instagram accounts the customer shared with the app. */
export async function discoverAssets(token: string, app: MetaApp): Promise<{ pages: PageAsset[]; instagram: InstagramAsset[] }> {
  const pages: PageAsset[] = []
  const instagram: InstagramAsset[] = []
  const seen = new Set<string>()

  const p = await graph('GET', '/me/accounts', token, app, { fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: '100' })
  for (const row of (p.ok && Array.isArray(p.data.data) ? p.data.data : []) as Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string; name?: string } }>) {
    if (!row.id || !NUMERIC_ID.test(row.id) || !row.access_token) continue
    const ig = row.instagram_business_account
    const igId = ig?.id && NUMERIC_ID.test(ig.id) ? ig.id : null
    pages.push({ id: row.id, name: row.name ?? `Page ${row.id}`, token: row.access_token, igId })
    if (igId && !seen.has(igId)) { seen.add(igId); instagram.push({ id: igId, username: ig?.username ?? null, name: ig?.name ?? null }) }
  }

  const a = await graph('GET', '/me/assigned_instagram_accounts', token, app, { fields: 'id,username,name', limit: '100' })
  for (const row of (a.ok && Array.isArray(a.data.data) ? a.data.data : []) as Array<{ id?: string; username?: string; name?: string }>) {
    if (!row.id || !NUMERIC_ID.test(row.id) || seen.has(row.id)) continue
    seen.add(row.id)
    instagram.push({ id: row.id, username: row.username ?? null, name: row.name ?? null })
  }
  return { pages, instagram }
}

/** Subscribe a Page or an Instagram account to our webhooks. */
export async function subscribeWebhooks(kind: 'page' | 'instagram', id: string, token: string, app: MetaApp): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!NUMERIC_ID.test(id)) return { ok: false, error: 'Invalid account id.' }
  const fields = (kind === 'page' ? PAGE_WEBHOOK_FIELDS : INSTAGRAM_WEBHOOK_FIELDS).join(',')
  const r = await graph('POST', `/${id}/subscribed_apps`, token, app, { subscribed_fields: fields })
  if (r.ok) return { ok: true }
  console.error(`[meta connect] ${kind} subscription failed:`, r.error?.code, r.error?.message)
  return { ok: false, error: r.error?.message ?? 'Meta refused the webhook subscription.' }
}

export async function unsubscribeWebhooks(id: string, token: string, app: MetaApp): Promise<void> {
  if (!NUMERIC_ID.test(id)) return
  await graph('DELETE', `/${id}/subscribed_apps`, token, app).catch(() => undefined)
}

export type SaveResult = { connected: boolean; name?: string | null; error?: string; webhook?: string }

/**
 * Save the chosen Page and/or Instagram account for this workspace. Refuses
 * an account another workspace holds (webhooks route by these ids).
 */
export async function saveSocialConnection(input: {
  accountId: string
  token: string
  app: MetaApp
  page: PageAsset | null
  instagram: InstagramAsset | null
  scopes: string[]
  expiresAt: Date | null
}): Promise<{ facebook: SaveResult | null; instagram: SaveResult | null }> {
  const scopesJson = JSON.stringify(input.scopes.slice(0, 100))
  let facebook: SaveResult | null = null
  let instagram: SaveResult | null = null

  if (input.page) {
    const page = input.page
    await ensureFacebookConfigTable()
    const taken = await prisma.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM facebook_config WHERE account_id <> ${input.accountId}::uuid AND page_id = ${page.id} LIMIT 1`
    if (taken.length > 0) {
      facebook = { connected: false, error: 'This Facebook Page is already connected to another workspace.' }
    } else {
      await prisma.$executeRaw`
        INSERT INTO facebook_config (id, account_id, access_token, page_id, page_name, status, test_error, last_tested_at, connected_via, token_kind, granted_permissions, token_expires_at, updated_at)
        VALUES (${randomUUID()}::uuid, ${input.accountId}::uuid, ${sealSecret(page.token)}, ${page.id}, ${page.name}, 'connected', null, now(), 'login', 'page', ${scopesJson}::jsonb, null, now())
        ON CONFLICT (account_id) DO UPDATE SET
          access_token = EXCLUDED.access_token, page_id = EXCLUDED.page_id, page_name = EXCLUDED.page_name,
          status = 'connected', test_error = null, last_tested_at = now(), connected_via = 'login',
          token_kind = 'page', granted_permissions = EXCLUDED.granted_permissions, token_expires_at = null, updated_at = now()`
      const sub = await subscribeWebhooks('page', page.id, page.token, input.app)
      facebook = { connected: true, name: page.name, ...(sub.ok ? {} : { webhook: sub.error }) }
    }
  }

  if (input.instagram) {
    const ig = input.instagram
    await ensureInstagramConfigTable()
    const linkedPage = input.page && input.page.igId === ig.id ? input.page.id : null
    const taken = await prisma.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM instagram_config WHERE account_id <> ${input.accountId}::uuid AND instagram_account_id = ${ig.id} LIMIT 1`
    if (taken.length > 0) {
      instagram = { connected: false, error: 'This Instagram account is already connected to another workspace.' }
    } else {
      await prisma.$executeRaw`
        INSERT INTO instagram_config (id, account_id, access_token, instagram_account_id, page_id, ig_username, ig_name, status, test_error, last_tested_at, connected_via, token_kind, granted_permissions, token_expires_at, updated_at)
        VALUES (${randomUUID()}::uuid, ${input.accountId}::uuid, ${sealSecret(input.token)}, ${ig.id}, ${linkedPage}, ${ig.username}, ${ig.name}, 'connected', null, now(), 'login', 'system_user', ${scopesJson}::jsonb, ${input.expiresAt}, now())
        ON CONFLICT (account_id) DO UPDATE SET
          access_token = EXCLUDED.access_token, instagram_account_id = EXCLUDED.instagram_account_id, page_id = EXCLUDED.page_id,
          ig_username = EXCLUDED.ig_username, ig_name = EXCLUDED.ig_name, status = 'connected', test_error = null,
          last_tested_at = now(), connected_via = 'login', token_kind = 'system_user',
          granted_permissions = EXCLUDED.granted_permissions, token_expires_at = EXCLUDED.token_expires_at, updated_at = now()`
      const sub = await subscribeWebhooks('instagram', ig.id, input.token, input.app)
      instagram = { connected: true, name: ig.username ?? ig.name, ...(sub.ok ? {} : { webhook: sub.error }) }
    }
  }
  return { facebook, instagram }
}
