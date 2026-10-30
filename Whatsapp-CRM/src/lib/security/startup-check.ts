/**
 * What server.ts checks before it serves a single request.
 *
 * ── Why at startup ──────────────────────────────────────────────────
 *
 * Every secret here fails quietly when it is wrong. An empty or
 * placeholder NEXTAUTH_SECRET signs session cookies anybody can forge
 * (the placeholder is in the repository); an ENCRYPTION_KEY that is not
 * 64 hex characters makes Buffer.from(key, 'hex') a shorter key, or no
 * key, and every saved access token is then encrypted with it. None of
 * that shows up as an error a person would notice — so a production
 * server refuses to start instead, and says which variable, never what
 * it holds.
 *
 * Imported by server.ts (run by tsx, outside the "@/..." alias), so no
 * imports at all.
 */

type Env = Record<string, string | undefined>

/**
 * Whether to run Next in development mode.
 *
 * Only when NODE_ENV says so. It used to be "anything but production",
 * so a server started without NODE_ENV — a hand-run `npx tsx server.ts`,
 * a pm2 file missing the line — ran the development build: non-Secure
 * session cookies, full error overlays with stack traces, no
 * optimisation, on the public internet.
 */
export function isDevServer(env: Env): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim()
  if (nodeEnv) return nodeEnv === 'development'
  // No NODE_ENV at all. package.json's "dev" and "start" are both a bare
  // `tsx server.ts`, so the script npm is running is the only thing that
  // tells a laptop's `npm run dev` from a server's `npm start`. Anything
  // else — pm2, a hand-run tsx — is production.
  return (env.npm_lifecycle_event ?? '').trim() === 'dev'
}

/** Values copied from .env.local.example or tutorials, never real secrets. */
const PLACEHOLDERS = [
  'generate-a-long-random-string',
  'changeme',
  'change-me',
  'change_me',
  'replace-me',
  'replaceme',
  'your-secret',
  'your_secret',
  'yoursecret',
  'secret',
  'password',
  'example',
  'placeholder',
  'xxxxxxxx',
]

/** Below this, a session-signing secret is guessable. 32 characters is
 *  what `openssl rand -base64 32` (44) and the docs comfortably exceed. */
const MIN_SECRET_LENGTH = 32

const SECRET_FIX =
  'Generate one with `openssl rand -hex 32` and set it in the server\'s environment (changing it signs everyone out once). See docs/deploy/HARDENING.md, "Upgrading an existing server".'
const KEY_FIX =
  'If this server already has stored tokens, do NOT generate a new key — that makes all stored tokens unreadable; restore the key it was using. Only a brand-new server takes a fresh one (`openssl rand -hex 32`). See docs/deploy/HARDENING.md, "Upgrading an existing server".'

/** What is wrong with a session secret, in words that never include it. */
function weakSecret(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return 'is not set'
  if (v.length < MIN_SECRET_LENGTH) return `is ${v.length} characters long; it must be at least ${MIN_SECRET_LENGTH}`
  const lower = v.toLowerCase()
  // Each word is public (it is in this list) and shorter than the value,
  // so naming it never reveals the secret.
  const word = PLACEHOLDERS.find((p) => lower.includes(p))
  if (word) return `contains the placeholder word "${word}"`
  if (new Set(v).size < 8) return `is not random (only ${new Set(v).size} different characters)`
  return null
}

function weakEncryptionKey(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return 'is not set'
  if (!/^[0-9a-fA-F]{64}$/.test(v)) {
    return /^[0-9a-fA-F]*$/.test(v)
      ? `is ${v.length} characters long; it must be exactly 64 hexadecimal characters (32 bytes)`
      : `is ${v.length} characters long; it must be exactly 64 hexadecimal characters (32 bytes), and it has characters other than 0-9 and a-f`
  }
  if (new Set(v.toLowerCase()).size < 4) return 'is not random'
  return null
}

/**
 * Problems with this environment. `errors` must stop a production server;
 * `warnings` are logged loudly and it starts anyway. Messages name the
 * variable and never contain its value.
 */
export function checkStartupEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  // Anything not explicitly development is treated as production.
  if (isDevServer(env)) return { errors, warnings }

  const session = weakSecret(env.NEXTAUTH_SECRET)
  if (session) errors.push(`NEXTAUTH_SECRET ${session}. ${SECRET_FIX}`)
  // NextAuth prefers AUTH_SECRET when both exist; the proxy reads
  // NEXTAUTH_SECRET. A weak AUTH_SECRET is therefore what signs cookies.
  if (env.AUTH_SECRET !== undefined) {
    const auth = weakSecret(env.AUTH_SECRET)
    if (auth) errors.push(`AUTH_SECRET ${auth}. ${SECRET_FIX}`)
    else if (env.AUTH_SECRET !== env.NEXTAUTH_SECRET) {
      warnings.push('AUTH_SECRET differs from NEXTAUTH_SECRET: sign-in and the proxy would disagree. Set NEXTAUTH_SECRET only.')
    }
  }
  const key = weakEncryptionKey(env.ENCRYPTION_KEY)
  if (key) errors.push(`ENCRYPTION_KEY ${key}. ${KEY_FIX}`)

  if (['development', 'dev', 'local'].includes((env.APP_ENV ?? '').trim().toLowerCase())) {
    warnings.push('APP_ENV is set to development on a production server: outgoing messages are blocked and background jobs are off.')
  }
  if ((env.META_SOCIAL_SIGNATURE ?? '').trim().toLowerCase() === 'observe') {
    warnings.push('META_SOCIAL_SIGNATURE=observe on a production server: Instagram/Facebook webhooks with a bad signature are accepted.')
  }
  if ((env.META_FLOWS_SIGNATURE ?? '').trim().toLowerCase() === 'observe') {
    warnings.push('META_FLOWS_SIGNATURE=observe on a production server: WhatsApp Flows endpoint requests with a bad signature are accepted.')
  }
  return { errors, warnings }
}
