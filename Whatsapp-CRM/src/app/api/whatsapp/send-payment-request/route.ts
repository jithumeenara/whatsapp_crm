import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from '@/lib/whatsapp/resolve-config'
import { sendOrderDetailsMessage, buildUpiIntentLink } from '@/lib/whatsapp/payments-api'
import { createRazorpayPaymentLink } from '@/lib/whatsapp/payment-gateways/razorpay'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/whatsapp/send-payment-request
 * Body: { conversation_id, amount, description? }
 *
 * Finding #09's actual send trigger — sends an order_details invoice
 * with a Razorpay UPI payment link. Gated: requires both a connected
 * PaymentGatewayConfig for the resolved number AND (unverifiable from
 * here) Meta having granted that number's WaBiz payments approval —
 * this route will happily build and send the request either way since
 * nothing in the Cloud API response distinguishes "approved" from "not
 * approved yet" ahead of time; a clean Meta-side rejection is the only
 * real signal, surfaced as this route's own error response.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = await request.json().catch(() => ({}))
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : undefined
    const amount = typeof body?.amount === 'number' ? body.amount : undefined
    const description = typeof body?.description === 'string' ? body.description : 'Payment request'

    if (!conversationId || !amount || amount <= 0) {
      return NextResponse.json({ error: 'conversation_id and a positive amount are required.' }, { status: 400 })
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        account_id: ctx.accountId,
        ...(ctx.role === 'agent' ? { assigned_agent_id: ctx.userId } : {}),
      },
      include: { contact: { select: { id: true, phone: true } } },
    })
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    if (!conversation.contact?.phone) return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 })

    let waConfig
    try {
      waConfig = await resolveWhatsAppConfig({ accountId: ctx.accountId, conversationId })
    } catch (err) {
      if (err instanceof NoWhatsAppConfigError) return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })
      throw err
    }

    const gatewayConfig = await prisma.paymentGatewayConfig.findUnique({ where: { whatsapp_config_id: waConfig.id } })
    if (!gatewayConfig) {
      return NextResponse.json({ error: 'No payment gateway connected for this number. Connect one in Settings > Payments first.' }, { status: 400 })
    }
    if (gatewayConfig.gateway !== 'razorpay') {
      return NextResponse.json({ error: `No adapter built for ${gatewayConfig.gateway} yet — only Razorpay can send today.` }, { status: 400 })
    }

    const referenceId = `wa-${randomUUID().slice(0, 12)}`
    const paymentRecord = await prisma.whatsAppPayment.create({
      data: {
        account_id: ctx.accountId,
        whatsapp_config_id: waConfig.id,
        conversation_id: conversationId,
        contact_id: conversation.contact.id,
        wa_order_message_id: `pending-${randomUUID()}`, // replaced once Meta returns a real wamid, below
        reference_id: referenceId,
        amount,
        currency: 'INR',
        status: 'pending',
      },
    })

    const { key_id: keyId, key_secret: keySecret } = JSON.parse(decrypt(gatewayConfig.credentials as string)) as { key_id: string; key_secret: string }

    let paymentLink: string
    try {
      const webhookRef = paymentRecord.id
      const link = await createRazorpayPaymentLink({
        credentials: { keyId, keySecret },
        amount,
        currency: 'INR',
        referenceId,
        description,
        customerPhone: conversation.contact.phone,
      })
      paymentLink = gatewayConfig.vpa
        ? buildUpiIntentLink({ vpa: gatewayConfig.vpa, payeeName: description, amount, referenceId })
        : link.shortUrl
      void webhookRef // documents intent: a real deployment wires this payment's id into the gateway's webhook/callback URL config
    } catch (err) {
      await prisma.whatsAppPayment.update({ where: { id: paymentRecord.id }, data: { status: 'failed' } })
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create the payment link.' }, { status: 502 })
    }

    try {
      const result = await sendOrderDetailsMessage({
        phoneNumberId: waConfig.phone_number_id,
        accessToken: decrypt(waConfig.access_token),
        to: conversation.contact.phone,
        referenceId,
        items: [{ retailerId: referenceId, name: description, amount, quantity: 1 }],
        currency: 'INR',
        totalAmount: amount,
        paymentLink,
      })

      const updated = await prisma.whatsAppPayment.update({
        where: { id: paymentRecord.id },
        data: { wa_order_message_id: result.messageId },
      })
      emitToAccount(ctx.accountId, 'whatsapp_payment', { eventType: 'INSERT', new: updated, old: {} })

      // Persist + emit a Message row so this shows up in the Inbox thread
      // like every other send — the WhatsAppPayment row above is this
      // feature's own ledger, not a substitute for the conversation view.
      const preview = `Payment request: ₹${amount.toFixed(2)}${description ? ` — ${description}` : ''}`
      const savedMsg = await prisma.message.create({
        data: {
          conversation_id: conversationId,
          sender_type: 'agent',
          sender_id: ctx.userId,
          content_type: 'payment_order_details',
          content_text: preview,
          message_id: result.messageId,
          status: 'sent',
        },
      })
      const lastMessageAt = new Date()
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { last_message_text: preview, last_message_at: lastMessageAt },
      })
      emitToAccount(ctx.accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })
      emitToAccount(ctx.accountId, 'conversation', {
        eventType: 'UPDATE',
        new: { id: conversationId, last_message_text: preview, last_message_at: lastMessageAt.toISOString() },
        old: {},
      })

      return NextResponse.json({ success: true, whatsapp_message_id: result.messageId, reference_id: referenceId })
    } catch (err) {
      await prisma.whatsAppPayment.update({ where: { id: paymentRecord.id }, data: { status: 'failed' } })
      const message = err instanceof Error ? err.message : 'Meta rejected the payment request.'
      return NextResponse.json({
        error: `${message} — if this mentions payments not being enabled, Meta hasn't yet approved the WaBiz payments case for this number.`,
      }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
