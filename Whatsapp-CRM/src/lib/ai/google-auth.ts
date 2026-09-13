/**
 * Service-account access tokens for Google Cloud APIs.
 *
 * Hand-rolled rather than pulling in google-auth-library: the whole flow
 * is one signed JWT exchanged for a bearer token, and Node's crypto signs
 * RS256 directly.
 *
 * Credentials come from one of two places, in this order:
 *
 *   1. The account's own uploaded service account, stored encrypted on
 *      its ai_configs row. This is what the product offers, and on a
 *      multi-tenant install it is the only version that lets two
 *      accounts use two different Cloud projects.
 *   2. The process environment, as a shared fallback. Existing
 *      deployments keep working with no change.
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

/**
 * Cached tokens, keyed by the identity that minted them.
 *
 * The key is not decoration. This was a single module-global entry keyed
 * only by scope, which is harmless while every request shares one
 * environment credential — and a cross-tenant leak the moment accounts
 * bring their own: the first account to authenticate would have its
 * access token handed to the next account's synthesis call, against a
 * Cloud project it has nothing to do with.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

/**
 * Parses service-account JSON, returning null for anything that is not
 * one rather than throwing.
 */
export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount> & { type?: string }
    if (!parsed.client_email || !parsed.private_key) return null
    return {
      client_email: parsed.client_email,
      // A JSON key stored as a single-line environment variable has its
      // newlines turned into the literal characters \ and n, which makes
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

/**
 * Reads the shared service account from the environment.
 *
 * Three accepted shapes, because deployment platforms differ on what
 * they will hold in a variable:
 *   - GOOGLE_TTS_CREDENTIALS — the JSON itself
 *   - GOOGLE_TTS_CREDENTIALS_B64 — the same JSON, base64 encoded, for
 *     platforms that mangle newlines in multi-line values
 *   - GOOGLE_APPLICATION_CREDENTIALS — a path to the JSON file
 *
 * Returns null rather than throwing when none is set: Cloud TTS is an
 * upgrade over the built-in voice, not a requirement.
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
      // Unreadable or missing is "not configured", not an error: the
      // built-in voice still works without it.
      return null
    }
  }
  if (!json) return null
  return parseServiceAccount(json)
}

export function hasCloudCredentials(): boolean {
  return loadServiceAccount() !== null
}

function base64url(input: string | object): string {
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  return Buffer.from(text).toString('base64url')
}

/**
 * Returns a bearer token for `scope`, reusing a cached one until it is
 * close to expiring.
 *
 * Caching matters more than it looks: a voice reply would otherwise pay
 * for a token round trip before every synthesis, doubling the latency of
 * the fastest part of the pipeline.
 */
export async function getAccessToken(
  scope = 'https://www.googleapis.com/auth/cloud-platform',
  account?: ServiceAccount | null,
): Promise<string> {
  const sa = account ?? loadServiceAccount()
  if (!sa) throw new Error('No Google Cloud service account is configured.')

  const cacheKey = `${sa.client_email}::${scope}`
  const hit = tokenCache.get(cacheKey)
  if (hit && Date.now() < hit.expiresAt - REFRESH_MARGIN_MS) return hit.token

  const now = Math.floor(Date.now() / 1000)
  const header = base64url({ alg: 'RS256', typ: 'JWT' })
  const claims = base64url({
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  })

  let signature: string
  try {
    signature = crypto
      .createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(sa.private_key)
      .toString('base64url')
  } catch (err) {
    // Almost always a mangled PEM rather than a genuinely bad key, and
    // the raw OpenSSL message says nothing a person can act on.
    throw new Error(
      `The private key could not be used to sign. It is likely malformed — check the JSON was uploaded whole. (${err instanceof Error ? err.message : String(err)})`,
    )
  }

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
      `Google refused these credentials: ${body.error_description ?? body.error ?? res.status}`,
    )
  }

  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  })
  return body.access_token
}

/** Drops a cached token. Called when a request comes back 401, so the
 *  next attempt fetches a fresh one rather than replaying a revoked one.
 *  With no identity, clears everything — used when a key is replaced. */
export function clearTokenCache(account?: ServiceAccount | null): void {
  if (!account) {
    tokenCache.clear()
    return
  }
  for (const key of tokenCache.keys()) {
    if (key.startsWith(`${account.client_email}::`)) tokenCache.delete(key)
  }
}
