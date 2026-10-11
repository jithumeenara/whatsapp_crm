/**
 * Google sign-in for one CRM account, through the account's own Google
 * Cloud OAuth app.
 *
 * Scope: drive.file only. The CRM can open a file someone picked in the
 * Google Picker, or one it created itself — never the rest of their Drive.
 * Google counts drive.file as non-sensitive, so the app needs brand
 * verification only, not the months-long security review that reading
 * every spreadsheet would. openid + email name the connected account.
 *
 * The client secret and every token are stored encrypted (AES-256-GCM,
 * the same key as WhatsApp tokens) and never reach the browser. The one
 * thing the browser does get is a short-lived access token, for the
 * Picker — the Picker needs one to list files, and with drive.file it
 * can list only what the person chooses in it.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { ensureGoogleTables } from './store'

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOKE = 'https://oauth2.googleapis.com/revoke'
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo'

export const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file'
export const GOOGLE_CALLBACK_PATH = '/api/google/callback'
export const GOOGLE_OAUTH_COOKIE = 'google_oauth'

/** "123456789012-abc.apps.googleusercontent.com" */
const CLIENT_ID = /^(\d{6,})-[a-z0-9]+\.apps\.googleusercontent\.com$/i

export function isGoogleClientId(v: unknown): v is string {
  return typeof v === 'string' && CLIENT_ID.test(v.trim())
}

/** The Cloud project number — the Picker's "app id", which is what lets a
 *  picked file be opened under drive.file. It is the client id's prefix. */
export function projectNumberOf(clientId: string): string | null {
  return CLIENT_ID.exec(clientId.trim())?.[1] ?? null
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function googleAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  /** The chosen services' scopes. Defaults to the Sheets set. */
  scopes?: readonly string[]
  /** Adding services to a connected account: stay on that account. */
  loginHint?: string | null
}): string {
  if (!isGoogleClientId(args.clientId)) throw new Error('Invalid Google client id')
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scopes?.length ? args.scopes.join(' ') : GOOGLE_SCOPES,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    // offline + consent: Google only issues a refresh token on the first
    // consent unless asked again, and without one the connection would
    // die in an hour.
    access_type: 'offline',
    // Incremental authorization: what was granted before stays granted,
    // so adding Calendar does not silently drop Sheets.
    include_granted_scopes: 'true',
    prompt: args.loginHint ? 'consent' : 'consent select_account',
  })
  if (args.loginHint) q.set('login_hint', args.loginHint)
  return `${AUTH}?${q}`
}

/** Scopes as Google reports them, normalised: "email" may come back as
 *  ".../userinfo.email", which is the same permission. */
export function normaliseScopes(raw: string | readonly string[] | null | undefined): string[] {
  const list = typeof raw === 'string' ? raw.split(/\s+/) : [...(raw ?? [])]
  const out = new Set<string>()
  for (const s of list) {
    if (!s) continue
    if (s === 'https://www.googleapis.com/auth/userinfo.email') out.add('email')
    else if (s === 'https://www.googleapis.com/auth/userinfo.profile') out.add('profile')
    else out.add(s)
  }
  return [...out]
}

/** Whether a service is switched on and its scopes still granted. */
export async function isGoogleServiceEnabled(accountId: string, serviceId: string): Promise<boolean> {
  const conn = await loadGoogleConnection(accountId).catch(() => null)
  if (!conn || conn.status !== 'connected' || !conn.refresh_token) return false
  if (!conn.enabled_services.includes(serviceId)) return false
  const { serviceById } = await import('./services')
  const svc = serviceById(serviceId)
  return Boolean(svc && svc.scopes.every((s) => conn.granted_scopes.includes(s)))
}

/** One line in Settings → Google → Activity. Never throws. */
export async function logGoogleActivity(accountId: string, userId: string | null, action: string, detail?: string): Promise<void> {
  await prisma.googleActivity
    .create({ data: { account_id: accountId, user_id: userId, action, detail: detail?.slice(0, 500) ?? null } })
    .catch((err) => console.error('[google] activity log failed:', err instanceof Error ? err.message : err))
}

export type CheckResult = { id: string; label: string; ok: boolean | null; detail: string }

/**
 * "Verify" on the app details, without anyone signing in.
 *
 *  - Client secret: a token request with a code that cannot be valid.
 *    Google says "invalid_client" when the id or secret is wrong, and
 *    "invalid_grant" when they are right and only the code is bad — so
 *    the secret is tested without ever completing a sign-in. A redirect
 *    URI that is not registered comes back as "redirect_uri_mismatch".
 *  - API key: one Sheets API call with the key. A key Google does not
 *    know says API_KEY_INVALID; a key restricted to the Picker or to this
 *    website answers otherwise, which still proves it exists.
 */
export async function verifyGoogleApp(args: {
  clientId: string
  clientSecret: string
  apiKey: string | null
  redirectUri: string
  origin: string
}): Promise<CheckResult[]> {
  const checks: CheckResult[] = []
  const idOk = isGoogleClientId(args.clientId)
  checks.push({
    id: 'client_id',
    label: 'Client ID',
    ok: idOk,
    detail: idOk ? `Project ${projectNumberOf(args.clientId)}` : 'Not a Google OAuth client ID — it ends in .apps.googleusercontent.com.',
  })

  if (idOk) {
    try {
      const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: args.clientId,
          client_secret: args.clientSecret,
          grant_type: 'authorization_code',
          code: 'crm-configuration-check',
          redirect_uri: args.redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
      if (body.error === 'invalid_grant') {
        checks.push({ id: 'client_secret', label: 'Client secret', ok: true, detail: 'Google accepted the client ID and secret.' })
        checks.push({ id: 'redirect_uri', label: 'Redirect URI', ok: true, detail: args.redirectUri })
      } else if (body.error === 'redirect_uri_mismatch') {
        checks.push({ id: 'client_secret', label: 'Client secret', ok: true, detail: 'Google accepted the client ID and secret.' })
        checks.push({
          id: 'redirect_uri',
          label: 'Redirect URI',
          ok: false,
          detail: `Add ${args.redirectUri} under Authorized redirect URIs of this OAuth client.`,
        })
      } else if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
        checks.push({
          id: 'client_secret',
          label: 'Client secret',
          ok: false,
          detail: 'Google rejected the client ID and secret. Copy both again from Google Cloud → Credentials (a secret that was reset no longer works).',
        })
      } else {
        checks.push({
          id: 'client_secret',
          label: 'Client secret',
          ok: null,
          detail: body.error_description || body.error || `Google answered ${res.status}; could not tell.`,
        })
      }
    } catch (err) {
      checks.push({ id: 'client_secret', label: 'Client secret', ok: null, detail: `Could not reach Google: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  if (!args.apiKey) {
    checks.push({ id: 'api_key', label: 'Picker API key', ok: false, detail: 'Missing — sheets and files cannot be chosen without it.' })
  } else {
    try {
      // Google's own public sample spreadsheet.
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms?fields=properties.title&key=${encodeURIComponent(args.apiKey)}`,
        { headers: { Referer: `${args.origin}/` }, signal: AbortSignal.timeout(10_000) },
      )
      if (res.ok) {
        checks.push({ id: 'api_key', label: 'Picker API key', ok: true, detail: 'Google accepted the key.' })
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; details?: Array<{ reason?: string }> } }
        const reason = body.error?.details?.find((d) => d.reason)?.reason ?? ''
        const msg = body.error?.message ?? ''
        if (reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) {
          checks.push({ id: 'api_key', label: 'Picker API key', ok: false, detail: 'Google does not know this key. Copy it again from Credentials.' })
        } else {
          // Restricted to the Picker, or to this site, or Sheets API off in
          // this project — all mean the key itself is real.
          checks.push({ id: 'api_key', label: 'Picker API key', ok: true, detail: 'The key exists (it is restricted, as it should be).' })
          if (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled/i.test(msg)) {
            checks.push({
              id: 'sheets_api',
              label: 'Google Sheets API',
              ok: false,
              detail: 'Not enabled in this Google Cloud project. APIs & Services → Library → Google Sheets API → Enable.',
            })
          }
        }
      }
    } catch (err) {
      checks.push({ id: 'api_key', label: 'Picker API key', ok: null, detail: `Could not reach Google: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return checks
}

/** What the current access token was actually granted — Google's own
 *  answer, so a permission removed in the Google account shows up here. */
export async function grantedScopesOf(accessToken: string): Promise<string[] | null> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json().catch(() => ({}))) as { scope?: string }
  return typeof body.scope === 'string' ? normaliseScopes(body.scope) : null
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    // invalid_grant is the one people meet: the app is still in Testing
    // (tokens die after 7 days) or access was removed in their account.
    if (data.error === 'invalid_grant') {
      throw new Error(
        'Google refused the saved sign-in. Connect Google again. If this keeps happening after about a week, the OAuth app is still in "Testing" — publish it to Production in Google Cloud.',
      )
    }
    throw new Error(data.error_description || data.error || `Google token request failed (HTTP ${res.status})`)
  }
  return data
}

export function exchangeGoogleCode(args: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
}): Promise<TokenResponse> {
  return tokenRequest({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
  })
}

export async function googleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json().catch(() => ({}))) as { email?: string }
  return typeof body.email === 'string' ? body.email.toLowerCase() : null
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(`${REVOKE}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}

export async function loadGoogleConnection(accountId: string) {
  await ensureGoogleTables()
  return prisma.googleConnection.findUnique({ where: { account_id: accountId } })
}

export class GoogleNotConnectedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Google is not connected. Connect it in Settings → Google.')
    this.name = 'GoogleNotConnectedError'
  }
}

/**
 * A working access token for the account, refreshed when it has under
 * five minutes left. A refresh Google refuses marks the connection as
 * needing a reconnect, so Settings says so instead of every sync failing
 * with the same message.
 */
export async function googleAccessToken(accountId: string): Promise<string> {
  const conn = await loadGoogleConnection(accountId)
  if (!conn || conn.status !== 'connected' || !conn.refresh_token) throw new GoogleNotConnectedError()
  if (conn.access_token && conn.access_expires_at && conn.access_expires_at.getTime() - Date.now() > 5 * 60_000) {
    return decrypt(conn.access_token)
  }
  try {
    const tokens = await tokenRequest({
      client_id: conn.client_id,
      client_secret: decrypt(conn.client_secret),
      grant_type: 'refresh_token',
      refresh_token: decrypt(conn.refresh_token),
    })
    await prisma.googleConnection.update({
      where: { id: conn.id },
      data: {
        access_token: encrypt(tokens.access_token),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        ...(tokens.refresh_token ? { refresh_token: encrypt(tokens.refresh_token) } : {}),
        last_error: null,
      },
    })
    return tokens.access_token
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.googleConnection
      .update({ where: { id: conn.id }, data: { status: 'error', last_error: message } })
      .catch(() => {})
    throw new GoogleNotConnectedError(message)
  }
}

/**
 * A token for the browser that can do less than the account's own.
 *
 * The connection's token carries every scope granted — Gmail and Calendar
 * included — so it never leaves the server. Google lets a refresh ask for
 * a subset of what was granted; the Picker gets drive.file and nothing
 * else, which is why an agent may have one. Kept in memory a little under
 * its hour; a failure here leaves the connection's status alone.
 */
const narrowTokens = new Map<string, { token: string; until: number }>()
export async function googleNarrowToken(accountId: string, scopes: readonly string[]): Promise<string> {
  const key = `${accountId}|${[...scopes].sort().join(' ')}`
  const hit = narrowTokens.get(key)
  if (hit && hit.until > Date.now()) return hit.token
  const conn = await loadGoogleConnection(accountId)
  if (!conn || conn.status !== 'connected' || !conn.refresh_token) throw new GoogleNotConnectedError()
  if (!scopes.every((s) => conn.granted_scopes.includes(s))) throw new GoogleNotConnectedError('That Google permission was not granted.')
  try {
    const tokens = await tokenRequest({
      client_id: conn.client_id,
      client_secret: decrypt(conn.client_secret),
      grant_type: 'refresh_token',
      refresh_token: decrypt(conn.refresh_token),
      scope: scopes.join(' '),
    })
    narrowTokens.set(key, { token: tokens.access_token, until: Date.now() + Math.max(60, tokens.expires_in - 600) * 1000 })
    return tokens.access_token
  } catch (err) {
    throw new GoogleNotConnectedError(err instanceof Error ? err.message : String(err))
  }
}

/** Whether the account can use Google right now — a cheap check for UI
 *  and for choosing between the API and the public-link path. */
export async function isGoogleConnected(accountId: string): Promise<boolean> {
  const conn = await loadGoogleConnection(accountId).catch(() => null)
  return Boolean(conn && conn.status === 'connected' && conn.refresh_token)
}

/**
 * Every 15 minutes from server.ts, for each connected account: refresh the
 * token (a revoked grant is caught here, not at the next customer-facing
 * use) and re-read what Google says is granted, so a permission removed
 * in the Google account turns its card to "Missing permission".
 */
export async function sweepGoogleHealth(): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const conns = await prisma.googleConnection
    .findMany({ where: { status: 'connected', refresh_token: { not: null } }, select: { id: true, account_id: true, granted_scopes: true } })
    .catch(() => [])
  for (const c of conns) {
    try {
      const token = await googleAccessToken(c.account_id)
      const scopes = await grantedScopesOf(token)
      const changed = scopes && scopes.slice().sort().join(' ') !== c.granted_scopes.slice().sort().join(' ')
      await prisma.googleConnection.update({
        where: { id: c.id },
        data: { last_health_at: new Date(), ...(scopes && changed ? { granted_scopes: scopes } : {}) },
      })
      if (changed) await logGoogleActivity(c.account_id, null, 'permissions_changed', `Google now reports: ${scopes?.join(', ')}`)
    } catch (err) {
      // googleAccessToken has already marked the connection as needing a reconnect.
      await logGoogleActivity(c.account_id, null, 'health_failed', err instanceof Error ? err.message : String(err))
    }
  }
}
