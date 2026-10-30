/**
 * An integration's credentials (an API key, a bearer token, a Basic-auth
 * username and password — the Razorpay key secret among them) at rest.
 *
 * auth_config is a JSON column, so the whole object is sealed as one
 * string under `sealed`, the same way every other stored secret is
 * (sealSecret / openStoredSecret). Rows saved before this were plain
 * objects; they read as they are and are sealed on the next save, so no
 * data migration is needed.
 */

import { isSealed, openStoredSecret, sealSecret } from '@/lib/whatsapp/encryption'

type AuthConfig = Record<string, unknown>

// Only a real ciphertext counts: a client could send { sealed: '<plain
// JSON>' } and have it stored in clear text otherwise.
function isSealedConfig(v: unknown): v is { sealed: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const sealed = (v as { sealed?: unknown }).sealed
  return typeof sealed === 'string' && isSealed(sealed)
}

/** What goes into integrations.auth_config. null / undefined stay as they are. */
export function sealAuthConfig(cfg: unknown): { sealed: string } | null | undefined {
  if (cfg === undefined || cfg === null) return cfg
  if (isSealedConfig(cfg)) return cfg
  return { sealed: sealSecret(JSON.stringify(cfg)) as string }
}

/** The credentials as the sync and payment routes use them. */
export function openAuthConfig(stored: unknown): AuthConfig | null {
  if (stored === undefined || stored === null) return null
  if (isSealedConfig(stored)) {
    // A corrupted value or one sealed under another key fails closed — the
    // integration just has no credentials — instead of throwing a crypto
    // or JSON error (which can quote part of the plaintext) into a route.
    try {
      const parsed: unknown = JSON.parse(openStoredSecret(stored.sealed))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as AuthConfig) : null
    } catch {
      console.error('[integrations] stored credentials could not be opened (wrong ENCRYPTION_KEY or corrupted value)')
      return null
    }
  }
  return typeof stored === 'object' && !Array.isArray(stored) ? (stored as AuthConfig) : null
}

/**
 * What the integrations screen sends back is never a redacted copy of what
 * it was given ({ has_secret }): if one arrives, the stored credentials stay.
 */
export function isRedactedEcho(cfg: unknown): boolean {
  return !!cfg && typeof cfg === 'object' && !Array.isArray(cfg) && 'has_secret' in cfg
}
