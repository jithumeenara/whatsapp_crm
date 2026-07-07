import { handleFlowWebhookPost } from '@/app/api/flows/[id]/webhook/route'

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
  return handleFlowWebhookPost(request, flowId)
}
