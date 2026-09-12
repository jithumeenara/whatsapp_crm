/**
 * Service-account access tokens for Google Cloud APIs.
 *
 * Hand-rolled rather than pulling in google-auth-library, because the
 * whole flow is one signed JWT exchanged for a bearer token and the
 * library would add a dependency tree for it. Node's crypto signs RS256
 * directly.
 *
 * Credentials come from the environment, never the database and never
 * the repository: a service-account private key grants access to a whole
 * Google Cloud project, which is a wider blast radius than the per-
 * account API keys stored in `provider_keys`. Deployment puts it in the
 * process environment; nothing here writes it anywhere.
 */

import crypto from 'crypto'
import { readFileSync } from 'fs'

export interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
  project_id: string
}

/** Tokens last an hour; refreshed a minute early so a request already in
 *  flight cannot arrive with one that expired in transit. */
const REFRESH_MARGIN_MS = 60_000

let cached: { token: string; expiresAt: number; scope: string } | null = null

/**
 * Reads the service account from the environment.
 *
 * Three accepted shapes, because deployment platforms differ on what
 * they will hold in a variable:
 *   - GOOGLE_TTS_CREDENTIALS — the JSON itself
 *   - GOOGLE_TTS_CREDENTIALS_B64 — the same JSON, base64 encoded, for
 *     platforms that mangle newlines in multi-line values
 *   - GOOGLE_APPLICATION_CREDENTIALS — a path to the JSON file
 *
 * Returns null rather than throwing when none is set: Cloud TTS is an
 * upgrade over the built-in voice, not a requirement, and an account
 * without it should keep working.
 */
export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_TTS_CREDENTIALS?.trim()
  const b64 = process.env.GOOGLE_TTS_CREDENTIALS_B64?.trim()
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()

  let json: string | null = null
  if (raw) json = raw
  else if (b64) json = Buffer.from(b64, 'base64').toString('utf8')
  else if (path) {
    try {
      json = readFileSync(path, 'utf8')
    } catch {
      // An unreadable or missing file is treated as "not configured"
      // rather than an error: Cloud TTS is an upgrade, and the built-in
      // voice still works without it.
      return null
    }
  }
  if (!json) return null

  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>
    if (!parsed.client_email || !parsed.private_key) return null
    return {
      client_email: parsed.client_email,
      // Platforms that store the JSON as a single-line env var turn the
      // key's newlines into the literal characters \ and n, which makes
      // the PEM unparseable and produces a signing error that looks
      // nothing like its cause.
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
      token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
      project_id: parsed.project_id ?? '',
    }
  } catch {
    return null
  }
}

export function hasCloudCredentials(): boolean {
  return loadServiceAccount() !== null
}

function base64url(input: string | object): string {
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  return Buffer.from(text).toString('base64url')
}

/**
 * Returns a bearer token for `scope`, reusing the cached one until it is
 * close to expiring.
 *
 * Caching matters more than it looks: a voice reply would otherwise pay
 * for a token round trip before every single synthesis, doubling the
 * latency of the fastest part of the pipeline.
 */
export async function getAccessToken(
  scope = 'https://www.googleapis.com/auth/cloud-platform',
): Promise<string> {
  if (cached && cached.scope === scope && Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) {
    return cached.token
  }

  const sa = loadServiceAccount()
  if (!sa) throw new Error('No Google Cloud service account is configured.')

  const now = Math.floor(Date.now() / 1000)
  const header = base64url({ alg: 'RS256', typ: 'JWT' })
  const claims = base64url({
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  })
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(sa.private_key)
    .toString('base64url')

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error_description?: string
    error?: string
  }

  if (!body.access_token) {
    throw new Error(
      `Google token exchange failed: ${body.error_description ?? body.error ?? res.status}`,
    )
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scope,
  }
  return cached.token
}

/** Drops the cached token. Used when a call fails with 401, so the next
 *  attempt fetches a fresh one instead of replaying a revoked token. */
export function clearTokenCache(): void {
  cached = null
}
