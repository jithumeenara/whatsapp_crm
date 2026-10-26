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

import { prisma } from '@/lib/db'
import { whatsappWebhookSecrets } from '@/lib/whatsapp/webhook-secrets'
import { checkMetaWebhookSignature, logSignatureCheck } from '@/lib/whatsapp/webhook-signature'

let cache: { at: number; secrets: string[] } | null = null
const TTL_MS = 60_000

export async function socialWebhookSecrets(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.secrets
  const secrets = new Set(await whatsappWebhookSecrets())
  if (process.env.INSTAGRAM_APP_SECRET) secrets.add(process.env.INSTAGRAM_APP_SECRET)
  try {
    const rows = await prisma.$queryRaw<Array<{ app_secret: string | null }>>`
      SELECT app_secret FROM facebook_config WHERE app_secret IS NOT NULL AND app_secret <> ''`
    for (const r of rows) if (r.app_secret) secrets.add(r.app_secret)
  } catch {
    // facebook_config is created on first use; no table means no secrets.
  }
  cache = { at: Date.now(), secrets: [...secrets] }
  return cache.secrets
}

/** True when the request may be processed. Logs why when it may not. */
export async function socialWebhookAllowed(rawBody: string, signature: string | null, channel: string): Promise<boolean> {
  const check = checkMetaWebhookSignature(rawBody, signature, await socialWebhookSecrets())
  if (check === 'ok') return true
  logSignatureCheck(check, signature)
  if (process.env.META_SOCIAL_SIGNATURE === 'observe') {
    console.warn(`[${channel} webhook] signature ${check} — let through because META_SOCIAL_SIGNATURE=observe`)
    return true
  }
  console.warn(`[${channel} webhook] turned away: signature ${check}. If real ${channel} messages stop, set the app secret (or META_SOCIAL_SIGNATURE=observe for now).`)
  return false
}
