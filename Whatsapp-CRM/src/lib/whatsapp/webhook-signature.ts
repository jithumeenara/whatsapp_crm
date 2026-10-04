import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   At least one App Secret is **required**. If none is configured we
 *   fail closed — every request is rejected until the operator sets one.
 *   A previous version fell open with a warning log, which is unsafe for
 *   a public template: anyone who forgets the env var would be running a
 *   fully spoofable webhook.
 *
 *   More than one secret may be passed: a server can hold the secret of
 *   the Meta app in `.env` and, separately, the one Quick Connect uses
 *   (saved in the database). Both are this operator's own apps; a request
 *   is genuine if it was signed with either.
 */

/** Why a request was or was not accepted — the diagnostic shows this. */
export type SignatureCheck = 'ok' | 'no_secret' | 'no_signature' | 'malformed' | 'mismatch'

export function checkMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets: readonly string[],
): SignatureCheck {
  const usable = secrets.filter((s) => typeof s === 'string' && s.length > 0)
  if (usable.length === 0) return 'no_secret'
  if (!signatureHeader) return 'no_signature'
  if (!/^sha256=[0-9a-f]{64}$/i.test(signatureHeader)) return 'malformed'

  const given = Buffer.from(signatureHeader.toLowerCase())
  let matched = false
  // Every secret is tried, matched or not, so the time taken says nothing
  // about which one (if any) was right.
  for (const secret of usable) {
    const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex'))
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) matched = true
  }
  return matched ? 'ok' : 'mismatch'
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets: readonly string[] = process.env.META_APP_SECRET ? [process.env.META_APP_SECRET] : [],
): boolean {
  const result = checkMetaWebhookSignature(rawBody, signatureHeader, secrets)
  logSignatureCheck(result, signatureHeader)
  return result === 'ok'
}

/** One log line saying why a webhook was turned away; silent when accepted. */
export function logSignatureCheck(result: SignatureCheck, signatureHeader: string | null): void {
  if (result === 'no_secret') {
    console.error(
      '[webhook] No Meta App Secret is configured — rejecting all requests. ' +
        'Set META_APP_SECRET in .env to the value from Meta → App Settings → Basic → App Secret.',
    )
  } else if (result === 'no_signature') {
    console.warn('[webhook] request has no x-hub-signature-256 header — likely a manual/test request, not from Meta')
  } else if (result === 'malformed') {
    console.warn('[webhook] x-hub-signature-256 header has unexpected format:', signatureHeader?.slice(0, 20))
  } else if (result === 'mismatch') {
    console.warn('[webhook] HMAC mismatch — the App Secret on this server is not the secret of the Meta app sending these webhooks')
  }
}
