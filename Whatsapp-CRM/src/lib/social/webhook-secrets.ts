/**
 * The Meta App Secrets an Instagram or Facebook webhook may be signed
 * with: the WhatsApp ones (.env and Quick Connect — the same Meta app
 * often delivers all three), INSTAGRAM_APP_SECRET for an app that uses
 * Instagram Login, and every tenant's own Facebook app secret saved in
 * Settings → Channels → Facebook.
 *
 * Without a check anyone who knew the URL could post messages into any
 * account's Inbox. Set META_SOCIAL_SIGNATURE=observe to let unsigned
 * events through with a log line while a secret is being fixed.
 *
 * Cached for a minute: the webhook is hot, and a changed secret is rare.
 */

import crypto from 'node:crypto'
import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'
import { whatsappWebhookSecrets } from '@/lib/whatsapp/webhook-secrets'
import { checkMetaWebhookSignature, logSignatureCheck } from '@/lib/whatsapp/webhook-signature'

/**
 * Who may have signed a request. A platform secret (.env, Quick Connect,
 * INSTAGRAM_APP_SECRET) belongs to this operator and vouches for any
 * event. A tenant's own Facebook app secret is typed in by that tenant,
 * so it vouches only for that tenant's own Page/Instagram account —
 * otherwise any account owner could sign an event naming somebody
 * else's Page and post it into their Inbox (and make their assistant
 * answer it with their Page token).
 */
export type SocialWebhookScope = { all: true } | { all: false; accountIds: ReadonlySet<string> }

interface SecretSet {
  platform: string[]
  tenants: Array<{ accountId: string; secret: string }>
}

let cache: { at: number; set: SecretSet } | null = null
const TTL_MS = 60_000

async function secretSet(): Promise<SecretSet> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set
  const platform = new Set(await whatsappWebhookSecrets())
  if (process.env.INSTAGRAM_APP_SECRET) platform.add(process.env.INSTAGRAM_APP_SECRET)
  const tenants: SecretSet['tenants'] = []
  try {
    const rows = await prisma.$queryRaw<Array<{ account_id: string; app_secret: string | null }>>`
      SELECT account_id::text AS account_id, app_secret FROM facebook_config WHERE app_secret IS NOT NULL AND app_secret <> ''`
    for (const r of rows) {
      if (!r.app_secret) continue
      try {
        tenants.push({ accountId: r.account_id, secret: openStoredSecret(r.app_secret) })
      } catch {
        // An undecryptable row must not stop every other secret working.
      }
    }
  } catch {
    // facebook_config is created on first use; no table means no secrets.
  }
  cache = { at: Date.now(), set: { platform: [...platform], tenants } }
  return cache.set
}

/** Every secret a request may be signed with — platform and tenant alike. */
export async function socialWebhookSecrets(): Promise<string[]> {
  const set = await secretSet()
  return [...new Set([...set.platform, ...set.tenants.map((t) => t.secret)])]
}

/**
 * Null when the request must be turned away; otherwise whose events it
 * may carry. Logs why when it is turned away.
 */
export async function socialWebhookScope(
  rawBody: string,
  signature: string | null,
  channel: string,
): Promise<SocialWebhookScope | null> {
  const set = await secretSet()
  const platformCheck = checkMetaWebhookSignature(rawBody, signature, set.platform)
  if (platformCheck === 'ok') return { all: true }

  const accountIds = new Set<string>()
  for (const t of set.tenants) {
    if (checkMetaWebhookSignature(rawBody, signature, [t.secret]) === 'ok') accountIds.add(t.accountId)
  }
  if (accountIds.size > 0) return { all: false, accountIds }

  // Why, in the same words the WhatsApp webhook uses: across every secret.
  const check = checkMetaWebhookSignature(rawBody, signature, [...set.platform, ...set.tenants.map((t) => t.secret)])
  logSignatureCheck(check, signature)
  if (process.env.META_SOCIAL_SIGNATURE === 'observe') {
    console.warn(`[${channel} webhook] signature ${check} — let through because META_SOCIAL_SIGNATURE=observe`)
    return { all: true }
  }
  console.warn(`[${channel} webhook] turned away: signature ${check}. If real ${channel} messages stop, set the app secret (or META_SOCIAL_SIGNATURE=observe for now).`)
  return null
}

/** True when an event for this account may be processed under `scope`. */
export function scopeAllows(scope: SocialWebhookScope, accountId: string): boolean {
  return scope.all || scope.accountIds.has(accountId)
}

/** True when the request may be processed. Logs why when it may not. */
export async function socialWebhookAllowed(rawBody: string, signature: string | null, channel: string): Promise<boolean> {
  return (await socialWebhookScope(rawBody, signature, channel)) !== null
}

/** Constant-time string compare (hashed first, so lengths do not leak). */
export function sameToken(given: string, expected: string | null | undefined): boolean {
  if (!expected) return false
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
