import { NextResponse } from 'next/server'
import { debugLog, handleFlowWebhookPost } from '@/lib/flows/webhook-handler'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

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
    // The debug log holds the last few submissions exactly as customers
    // typed them — names, phone numbers, Aadhaar numbers. This path is
    // open without a login because Meta has to reach it, so the log was
    // readable by anyone who had the Flow's URL. It now needs a signed-in
    // admin of the account that owns this Flow.
    try {
      const ctx = await requireRole('admin')
      const { id } = await params
      const flow = await prisma.flow.findFirst({
        where: { id, account_id: ctx.accountId },
        select: { id: true },
      })
      if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ log: debugLog.get(id) ?? [] })
    } catch (err) {
      return toErrorResponse(err)
    }
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
