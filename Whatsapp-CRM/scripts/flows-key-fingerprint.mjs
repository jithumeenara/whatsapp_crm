/**
 * The fingerprint of the key in FLOWS_PRIVATE_KEY, and nothing else.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * A Flows private key leaked. The obvious response is to rotate it —
 * but rotating replaces the key Meta holds, and every Flow stops
 * working until the new one is live. On a business that takes
 * registrations through Flows, that is real downtime.
 *
 * It may not be needed. The webhook resolves the key from the database
 * first and falls back to this environment variable only when the
 * database has none, so the leaked value may be a leftover that nothing
 * reads. If it is a different key from the live one, deleting the
 * variable ends the exposure with no downtime at all.
 *
 * Settling that means comparing two keys without revealing either. The
 * fingerprint is taken over the *public* half — derived from the
 * private one, never printed — so it can be compared out loud, pasted
 * into a chat, or read down a phone line safely. It matches what
 * Settings → WhatsApp → Manage Encryption Keys shows for the stored
 * key, and what Meta shows for the key it holds.
 *
 *   node scripts/flows-key-fingerprint.mjs
 *
 * Same fingerprint as the one in Settings  → the leaked key IS live.
 *                                            Rotate, and accept the
 *                                            Flow downtime.
 * Different, or "not set"                  → the leaked key is not in
 *                                            use. Delete the variable
 *                                            from .env and restart. No
 *                                            downtime.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Reads one variable out of a .env file without pulling in a parser,
 *  and without printing anything it finds. */
function readEnvValue(file, name) {
  if (!fs.existsSync(file)) return null
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.startsWith(`${name}=`)) continue
    let value = line.slice(name.length + 1).trim()
    // Strip one layer of matching quotes, then turn the escaped
    // newlines a PEM has to be written with back into real ones.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value.replace(/\\n/g, '\n')
  }
  return null
}

const root = process.cwd()
const pem =
  process.env.FLOWS_PRIVATE_KEY?.replace(/\\n/g, '\n') ??
  readEnvValue(path.join(root, '.env'), 'FLOWS_PRIVATE_KEY') ??
  readEnvValue(path.join(root, '.env.local'), 'FLOWS_PRIVATE_KEY')

if (!pem) {
  console.log('FLOWS_PRIVATE_KEY: not set.')
  console.log('Nothing to compare — this server has no leftover key in its environment.')
  process.exit(0)
}

try {
  const pub = crypto.createPublicKey(crypto.createPrivateKey(pem))
  const fingerprint = crypto
    .createHash('sha256')
    .update(pub.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .match(/.{2}/g)
    .join(':')

  console.log('FLOWS_PRIVATE_KEY is set.')
  console.log(`Fingerprint: ${fingerprint}`)
  console.log('')
  console.log('Compare with Settings > WhatsApp > Manage Encryption Keys.')
  console.log('  Same      -> the leaked key is live. Rotate it.')
  console.log('  Different -> it is a leftover. Remove the line from .env and restart.')
} catch (err) {
  // A malformed leftover is still worth reporting: it cannot be the
  // live key, which is itself the answer.
  console.log('FLOWS_PRIVATE_KEY is set, but it is not a usable RSA private key.')
  console.log(`(${err instanceof Error ? err.message : err})`)
  console.log('It cannot be the key in use. Remove the line from .env and restart.')
}
