import { handleFlowWebhookPost } from '@/lib/flows/webhook-handler'
import { checkFlowRequestSignature } from '@/lib/flows/flow-signature'

/**
 * POST /api/flows/data-exchange/[flowId]/[screenId]
 *
 * Meta WhatsApp Flows data-exchange endpoint — alternative URL pattern.
 * Some Meta SDK integrations call this path instead of /api/flows/[id]/webhook.
 * The [screenId] path segment is informational; the actual screen is extracted
 * from the decrypted payload inside the shared handler.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ flowId: string; screenId: string }> },
) {
  const { flowId } = await params
  // Meta's X-Hub-Signature-256, checked before anything is decrypted (A9-08).
  const signed = await checkFlowRequestSignature(request)
  if (signed.response) return signed.response
  return handleFlowWebhookPost(signed.request, flowId)
}
