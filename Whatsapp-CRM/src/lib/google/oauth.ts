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
}): string {
  if (!isGoogleClientId(args.clientId)) throw new Error('Invalid Google client id')
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    // offline + consent: Google only issues a refresh token on the first
    // consent unless asked again, and without one the connection would
    // die in an hour.
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  })
  return `${AUTH}?${q}`
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

/** Whether the account can use Google right now — a cheap check for UI
 *  and for choosing between the API and the public-link path. */
export async function isGoogleConnected(accountId: string): Promise<boolean> {
  const conn = await loadGoogleConnection(accountId).catch(() => null)
  return Boolean(conn && conn.status === 'connected' && conn.refresh_token)
}
