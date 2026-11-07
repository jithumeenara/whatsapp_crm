import { NextResponse } from 'next/server'
import { checkMetaWebhookSignature, logSignatureCheck } from '@/lib/whatsapp/webhook-signature'
import { whatsappWebhookSecrets } from '@/lib/whatsapp/webhook-secrets'

/**
 * Meta signs every WhatsApp Flows endpoint request with the app secret:
 * `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>`. Encryption
 * to the account's RSA key proves nothing about the sender — the public
 * key is public — so this is the check that the request came from Meta
 * (A9-08). Meta's Flows endpoint spec asks for HTTP 432 when the
 * signature does not match.
 *
 * The secrets are the WhatsApp webhook's (.env META_APP_SECRET and the
 * Quick Connect app secret), plus META_FLOWS_APP_SECRET when the Flow is
 * connected to a different Meta app.
 *
 * META_FLOWS_SIGNATURE=observe lets a bad or missing signature through
 * with a log line, for rolling this out on a server whose secret is not
 * yet right — the same idea as META_SOCIAL_SIGNATURE.
 *
 * Returns a fresh Request carrying the exact body that was checked (the
 * original body can be read only once), or the 432 response to send.
 */
export async function checkFlowRequestSignature(
  request: Request,
): Promise<{ request: Request; response?: never } | { response: Response; request?: never }> {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  // A Flow can be connected to its own Meta app, which signs with that
  // app's secret (seen live: every Flows request failed against the
  // webhook secrets). META_FLOWS_APP_SECRET is that secret, accepted here
  // only, never for the WhatsApp webhook.
  const flowsSecret = process.env.META_FLOWS_APP_SECRET?.trim()
  const secrets = [...(await whatsappWebhookSecrets()), ...(flowsSecret ? [flowsSecret] : [])]
  const check = checkMetaWebhookSignature(rawBody, signature, secrets)
  const forward = () => ({ request: new Request(request.url, { method: 'POST', headers: request.headers, body: rawBody }) })
  if (check === 'ok') return forward()

  logSignatureCheck(check, signature)
  if ((process.env.META_FLOWS_SIGNATURE ?? '').trim().toLowerCase() === 'observe') {
    console.warn(`[flows endpoint] signature ${check} — let through because META_FLOWS_SIGNATURE=observe`)
    return forward()
  }
  console.warn(`[flows endpoint] turned away: signature ${check}. If live Flows stop loading, check the Meta app secret (or set META_FLOWS_SIGNATURE=observe for now).`)
  return { response: NextResponse.json({ error: 'Invalid signature' }, { status: 432 }) }
}
