/**
 * The Meta App Secrets a WhatsApp webhook may be signed with.
 *
 * Meta signs every webhook with the secret of the app that delivers it.
 * A server can know two: META_APP_SECRET in .env (the app set up by hand)
 * and the one saved for Quick Connect (Embedded Signup) in Settings. A
 * number connected through Quick Connect is delivered by that app, so
 * checking only .env turned every one of its messages away whenever the
 * two differed — silently, from the business's point of view.
 *
 * Cached for a minute: the webhook is hot, and a changed secret is rare.
 */

import { loadMetaPlatformConfig } from './meta-platform-config'

let cache: { at: number; secrets: string[] } | null = null
const TTL_MS = 60_000

export async function whatsappWebhookSecrets(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.secrets
  const secrets: string[] = []
  const env = process.env.META_APP_SECRET
  if (env) secrets.push(env)
  try {
    const platform = await loadMetaPlatformConfig()
    if (platform?.appSecret && !secrets.includes(platform.appSecret)) secrets.push(platform.appSecret)
  } catch (err) {
    // A database hiccup or an undecryptable row must not stop .env's
    // secret from working.
    console.warn('[webhook] could not read the Quick Connect app secret:', err instanceof Error ? err.message : err)
  }
  cache = { at: Date.now(), secrets }
  return secrets
}
