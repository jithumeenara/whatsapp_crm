import { NextResponse } from 'next/server'
import { debugLog, handleFlowWebhookPost } from '@/lib/flows/webhook-handler'

/**
 * POST /api/flows/[id]/webhook
 *
 * Meta WhatsApp Flows data exchange endpoint.
 * Meta encrypts every request with your RSA public key.
 * We decrypt it, fetch fresh DB data, and return an AES-GCM encrypted response.
 *
 * Required env var:
 *   FLOWS_PRIVATE_KEY — your RSA-2048 private key (PEM format, use \n for line breaks)
 *
 * Configure in Meta Business Manager:
 *   Flow → Settings → Endpoint URI → https://your-domain.com/api/flows/[id]/webhook
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url)
  if (url.searchParams.get('debug') === '1') {
    const { id } = await params
    return NextResponse.json({ log: debugLog.get(id) ?? [] })
  }
  return NextResponse.json({ status: 'active' })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: flowId } = await params
  return handleFlowWebhookPost(request, flowId)
}
