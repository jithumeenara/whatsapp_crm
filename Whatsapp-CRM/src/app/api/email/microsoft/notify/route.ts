import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { clientIpKey } from '@/lib/net/client-ip'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { accessTokenFor, getMessage, sweepMicrosoftSubscriptions } from '@/lib/email/microsoft/graph'
import { ensureMicrosoftMailboxTable } from '@/lib/email/microsoft/store'
import { processInbound } from '@/lib/email/ingest'

/**
 * POST /api/email/microsoft/notify — Microsoft Graph telling us a new
 * email arrived in a connected mailbox.
 *
 * Open without a login, because Microsoft has to reach it. What makes a
 * notification believable is the `clientState` it carries: a random
 * value per mailbox that only Graph and this server know, compared in
 * constant time. A notification that does not match is ignored. Even a
 * matching one only ever causes this server to fetch the message from
 * Graph itself — nothing in the notification is trusted as the email.
 *
 * Graph expects an answer within a few seconds, so the work happens
 * after the reply. (learn.microsoft.com — "Receive change notifications
 * through webhooks", "Reduce missing subscriptions and change
 * notifications".)
 */

interface Notification {
  subscriptionId?: string
  clientState?: string
  lifecycleEvent?: string
  resourceData?: { id?: string }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export async function POST(req: NextRequest) {
  // Creating or renewing a subscription: Graph proves the address works
  // by asking for this token back, as plain text.
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken !== null) {
    return new NextResponse(validationToken.slice(0, 1024), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    })
  }

  const limit = checkRateLimit(`ms-notify:${clientIpKey(req.headers)}`, RATE_LIMITS.inboundWebhookSecret)
  if (!limit.success) return rateLimitResponse(limit)

  const raw = await req.text().catch(() => '')
  if (raw.length > 1_000_000) return new NextResponse(null, { status: 413 })
  let items: Notification[] = []
  try {
    const parsed = JSON.parse(raw) as { value?: Notification[] }
    items = Array.isArray(parsed.value) ? parsed.value.slice(0, 100) : []
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  void handle(items).catch((err) =>
    console.error('[microsoft-mail] notification failed:', err instanceof Error ? err.message : err),
  )
  return new NextResponse(null, { status: 202 })
}

async function handle(items: Notification[]) {
  await ensureMicrosoftMailboxTable()
  for (const n of items) {
    if (!n.subscriptionId || !n.clientState) continue
    const box = await prisma.microsoftMailbox.findFirst({ where: { subscription_id: n.subscriptionId } })
    if (!box || !same(n.clientState, box.client_state)) continue

    if (n.lifecycleEvent) {
      if (n.lifecycleEvent === 'reauthorizationRequired' || n.lifecycleEvent === 'subscriptionRemoved') {
        // Renewed, or recreated, by the upkeep sweep — now, not in an hour.
        await prisma.microsoftMailbox.update({
          where: { id: box.id },
          data: {
            subscription_expires_at: null,
            ...(n.lifecycleEvent === 'subscriptionRemoved' ? { subscription_id: null } : {}),
          },
        })
        await sweepMicrosoftSubscriptions()
      }
      continue
    }

    const messageId = n.resourceData?.id
    if (!messageId) continue
    try {
      const token = await accessTokenFor(box)
      const msg = await getMessage(token, messageId)
      const from = msg.from?.emailAddress?.address?.trim().toLowerCase() ?? ''
      // Not a customer: something this mailbox sent to itself.
      if (!from || from === box.mailbox_email) continue
      const text = (msg.body?.content ?? msg.bodyPreview ?? '').trim().slice(0, 20_000)
      if (!text) continue
      await processInbound(box.account_id, box.user_id, {
        fromEmail: from,
        subject: (msg.subject ?? '').slice(0, 300),
        text,
        html: null,
        providerMessageId: msg.internetMessageId || `graph:${msg.id}`,
      })
    } catch (err) {
      console.error('[microsoft-mail] could not fetch a new message:', err instanceof Error ? err.message : err)
    }
  }
}
