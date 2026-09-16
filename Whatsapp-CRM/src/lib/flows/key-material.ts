/**
 * Reading a Flows RSA key, whatever shape it was stored in.
 *
 * Small and boring on purpose. It exists as its own module so it can be
 * tested directly, because the two functions in it caused an outage that
 * lasted weeks and was invisible the whole time:
 *
 *   privateKeyObject.export({ type: 'spki' })
 *
 * `spki` is a public-key encoding and Node rejects it on a private key,
 * so deriving the public half threw on every call. The caller swallowed
 * it, reported "No key configured", and invited the owner to generate a
 * replacement — which uploaded a new public key to Meta and broke every
 * published Flow, while the private half stayed exactly as unreadable as
 * before. Nothing in the UI, the logs or the database said so.
 *
 * A key that cannot be read is indistinguishable from a key that was
 * never created, right up until it costs you a fortnight. Hence the
 * tests next door.
 */

import crypto from 'crypto'

/**
 * Coaxes a PEM into the shape Node's parser insists on.
 *
 * Keys arrive here from environment variables, copy-paste, and database
 * columns, which between them produce `\n` escapes, CRLF, and bodies
 * with the line breaks stripped out entirely. All three are the same key
 * and all three should work.
 */
export function normalizePem(input: string): string {
  let pem = input
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  const m = pem.match(/^(-----BEGIN [^-]+-----)\s*([\s\S]+?)\s*(-----END [^-]+-----)$/)
  if (m) {
    const body = m[2].replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)
    if (wrapped) pem = `${m[1]}\n${wrapped.join('\n')}\n${m[3]}`
  }

  return pem
}

export interface PublicKeyInfo {
  /** SPKI PEM — the exact bytes Meta wants uploaded. */
  publicKey: string
  /** SHA-256 over the SPKI DER, colon-grouped. Taken over the public
   *  half so it can be compared with what Meta shows, rather than over a
   *  secret nobody can see. */
  fingerprint: string
}

/**
 * The public half of a private key, and a fingerprint for it.
 *
 * Throws if the PEM is not a usable RSA private key — callers are
 * expected to report that rather than treat it as "no key".
 */
export function derivePublicInfo(privateKeyPem: string): PublicKeyInfo {
  const keyObj = crypto.createPrivateKey(normalizePem(privateKeyPem))
  // The hop that was missing. A private KeyObject cannot export `spki`;
  // only the public key derived from it can.
  const pubObj = crypto.createPublicKey(keyObj)
  const publicKey = pubObj.export({ type: 'spki', format: 'pem' }) as string
  const fingerprint = crypto
    .createHash('sha256')
    .update(pubObj.export({ type: 'spki', format: 'der' }) as Buffer)
    .digest('hex')
    .match(/.{2}/g)!
    .join(':')
  return { publicKey, fingerprint }
}
