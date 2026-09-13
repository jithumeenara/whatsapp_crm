/**
 * Resolving which Google Cloud service account to speak with.
 *
 * Two sources, in this order:
 *
 *   1. The account's own uploaded key, stored encrypted on its
 *      ai_configs row. This is what the product offers, and the only
 *      version that lets two tenants use two different Cloud projects.
 *   2. The server's environment, as a shared fallback, so deployments
 *      that already set GOOGLE_TTS_CREDENTIALS keep working untouched.
 *
 * Kept apart from google-auth.ts because that module is deliberately
 * free of database and encryption imports — it is the piece that signs
 * JWTs, and the fewer things it reaches for the better.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseServiceAccount, loadServiceAccount, type ServiceAccount } from './google-auth'

export type CredentialSource = 'account' | 'environment' | 'none'

export interface ResolvedTtsCredentials {
  account: ServiceAccount | null
  source: CredentialSource
}

/**
 * Returns the credentials this account should speak with.
 *
 * An uploaded key that has never been verified is used anyway: the
 * upload path refuses to store one that did not work, so an unverified
 * row can only be a pre-existing record, and failing closed on it would
 * silently downgrade an account's voice with nothing to explain why.
 * A genuine failure at send time falls back to the built-in engine.
 */
export async function resolveTtsCredentials(accountId: string): Promise<ResolvedTtsCredentials> {
  try {
    const config = await prisma.aiConfig.findUnique({
      where: { account_id: accountId },
      select: { google_tts_credentials: true },
    })

    if (config?.google_tts_credentials) {
      const parsed = parseServiceAccount(decrypt(config.google_tts_credentials))
      if (parsed) return { account: parsed, source: 'account' }
      // Stored but unparseable — a key encrypted under a rotated
      // ENCRYPTION_KEY, most likely. Logged rather than thrown: the
      // environment may still have a usable one.
      console.error('[tts-credentials] stored service account could not be read for', accountId)
    }
  } catch (err) {
    console.error('[tts-credentials] lookup failed:', err instanceof Error ? err.message : err)
  }

  const fromEnv = loadServiceAccount()
  return fromEnv ? { account: fromEnv, source: 'environment' } : { account: null, source: 'none' }
}
