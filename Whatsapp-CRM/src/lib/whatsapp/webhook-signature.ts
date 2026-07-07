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
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    console.error(
      '[webhook] META_APP_SECRET is not set — rejecting all requests. ' +
        'Set META_APP_SECRET in your .env.local to the value from Meta → App Settings → Basic → App Secret.',
    )
    return false
  }

  if (!signatureHeader) {
    console.warn('[webhook] request has no x-hub-signature-256 header — likely a manual/test request, not from Meta')
    return false
  }
  if (!signatureHeader.startsWith('sha256=')) {
    console.warn('[webhook] x-hub-signature-256 header has unexpected format:', signatureHeader.slice(0, 20))
    return false
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) {
    console.warn('[webhook] signature length mismatch — META_APP_SECRET may not match the Meta App Secret in Meta for Developers')
    return false
  }
  if (!crypto.timingSafeEqual(a, b)) {
    console.warn('[webhook] HMAC mismatch — verify META_APP_SECRET matches Meta → App Settings → Basic → App Secret exactly')
    return false
  }
  return true
}
