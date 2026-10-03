/**
 * Settling a PhonePe payment from PhonePe's own answer.
 *
 * Two things call this: the webhook, as soon as PhonePe says something
 * happened, and a sweep, because PhonePe's documentation is plain that a
 * webhook may never arrive ("call the Order Status API using a
 * cron/scheduler until the terminal state"). Either way the decision is
 * the same status call, so a forged or lost webhook changes nothing.
 *
 * Imported by server.ts (the sweep), so nothing here may import
 * next/server — see the comment at the top of server.ts.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { emitToAccount } from '@/lib/socket'
import {
  getPhonePeLinkStatus,
  parsePhonePeCredentials,
  paymentStatusFor,
  toPaise,
} from './phonepe'

export type ReconcileOutcome = 'completed' | 'failed' | 'unchanged' | 'skipped' | 'amount_mismatch'

export async function reconcilePhonePePayment(paymentId: string): Promise<ReconcileOutcome> {
  const payment = await prisma.whatsAppPayment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.status !== 'pending') return 'skipped'

  const gatewayConfig = await prisma.paymentGatewayConfig.findUnique({
    where: { whatsapp_config_id: payment.whatsapp_config_id },
  })
  if (!gatewayConfig || gatewayConfig.gateway !== 'phonepe') return 'skipped'
  const credentials = parsePhonePeCredentials(decrypt(gatewayConfig.credentials as string))
  if (!credentials) return 'skipped'

  const status = await getPhonePeLinkStatus(credentials, payment.reference_id)
  const next = paymentStatusFor(status.state)

  if (next === 'pending') {
    // Still open. Touch the row so the sweep moves on to the others.
    await prisma.whatsAppPayment.update({ where: { id: payment.id }, data: { updated_at: new Date() } })
    return 'unchanged'
  }

  // Paid — but only for the amount this app asked for.
  if (next === 'completed' && status.amount !== toPaise(Number(payment.amount))) {
    console.error(
      `[phonepe] amount mismatch on ${payment.reference_id}: asked ${toPaise(Number(payment.amount))} paise, PhonePe reports ${status.amount}`,
    )
    await prisma.whatsAppPayment.update({ where: { id: payment.id }, data: { updated_at: new Date() } })
    return 'amount_mismatch'
  }

  // Only what reconciliation needs — masked account and VPA details in
  // PhonePe's full answer are left there.
  const snapshot = {
    gateway: 'phonepe',
    state: status.state,
    amount_paise: status.amount,
    payment_mode: status.paymentMode,
    checked_at: new Date().toISOString(),
  }

  // Conditional on still being pending: the webhook and the sweep can race,
  // and only one of them may move the payment and thank the customer.
  const moved = await prisma.whatsAppPayment.updateMany({
    where: { id: payment.id, status: 'pending' },
    data: {
      status: next,
      gateway_transaction_id: status.transactionId ?? payment.gateway_transaction_id,
      raw_payload: snapshot,
    },
  })
  if (moved.count === 0) return 'unchanged'

  const updated = await prisma.whatsAppPayment.findUnique({ where: { id: payment.id } })
  if (updated) emitToAccount(payment.account_id, 'whatsapp_payment', { eventType: 'UPDATE', new: updated, old: {} })

  if (next === 'completed' && payment.conversation_id) {
    await thankCustomer(payment.account_id, payment.whatsapp_config_id, payment.conversation_id, payment.contact_id, Number(payment.amount))
  }
  return next
}

/** A receipt line in the chat. Best effort: outside the 24-hour window
 *  Meta refuses free text, and a refused thank-you must not undo a
 *  recorded payment. */
async function thankCustomer(
  accountId: string,
  whatsappConfigId: string,
  conversationId: string,
  contactId: string | null,
  amount: number,
): Promise<void> {
  try {
    const [config, contact] = await Promise.all([
      prisma.whatsAppConfig.findUnique({ where: { id: whatsappConfigId } }),
      contactId ? prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } }) : null,
    ])
    if (!config || !contact?.phone) return
    const text = `Payment received: ₹${amount.toFixed(2)}. Thank you!`
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to: contact.phone,
      text,
    })
    const saved = await prisma.message.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    const at = new Date()
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { last_message_text: text, last_message_at: at },
    })
    emitToAccount(accountId, 'message', { eventType: 'INSERT', new: saved, old: {} })
    emitToAccount(accountId, 'conversation', {
      eventType: 'UPDATE',
      new: { id: conversationId, last_message_text: text, last_message_at: at.toISOString() },
      old: {},
    })
  } catch (err) {
    console.error('[phonepe] thank-you message not sent:', err instanceof Error ? err.message : err)
  }
}

// ── Sweep ────────────────────────────────────────────────────────────

/** A link lives at most 45 days; one day more covers a late final state. */
const SWEEP_HORIZON_MS = 46 * 24 * 60 * 60_000
const BATCH = 25

/** Fresh links are checked often, old ones rarely: most people pay within
 *  minutes or not at all, and a 45-day-old open link polled every two
 *  minutes would be thousands of calls for nothing. */
function checkEvery(ageMs: number): number {
  if (ageMs < 60 * 60_000) return 2 * 60_000
  if (ageMs < 24 * 60 * 60_000) return 15 * 60_000
  return 6 * 60 * 60_000
}

let sweeping = false

export async function sweepPhonePePayments(now: number = Date.now()): Promise<number> {
  if (sweeping) return 0
  sweeping = true
  try {
    const configs = await prisma.paymentGatewayConfig.findMany({
      where: { gateway: 'phonepe' },
      select: { whatsapp_config_id: true },
    })
    if (configs.length === 0) return 0

    const candidates = await prisma.whatsAppPayment.findMany({
      where: {
        whatsapp_config_id: { in: configs.map((c) => c.whatsapp_config_id) },
        status: 'pending',
        created_at: { gte: new Date(now - SWEEP_HORIZON_MS) },
        // Never sent to the customer: nobody can pay it, nothing to ask.
        NOT: { wa_order_message_id: { startsWith: 'pending-' } },
      },
      orderBy: { updated_at: 'asc' },
      take: BATCH,
      select: { id: true, created_at: true, updated_at: true },
    })

    let checked = 0
    for (const p of candidates) {
      const age = now - p.created_at.getTime()
      if (now - p.updated_at.getTime() < checkEvery(age)) continue
      try {
        await reconcilePhonePePayment(p.id)
        checked++
      } catch (err) {
        console.error(`[phonepe] status check failed for ${p.id}:`, err instanceof Error ? err.message : err)
      }
    }
    return checked
  } finally {
    sweeping = false
  }
}
