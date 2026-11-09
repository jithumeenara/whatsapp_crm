/**
 * Records what each WhatsApp message cost, from Meta's status webhook.
 *
 * Meta puts a `pricing` object (category, type, model) on the status of every
 * message it will charge for, on "sent" or on "delivered"/"read", but never
 * the price. The price comes from Meta's rate card (rate-card.ts) for the
 * business's currency. One row per message: the unique key on (account,
 * WhatsApp id) is what stops a status Meta repeats from counting twice, and
 * the insert skips a duplicate instead of failing.
 *
 * Only a message that is provably this business's is recorded: the lookup is
 * by WhatsApp id inside the account, so an event for a message we never sent,
 * or for another business, records nothing.
 *
 * Plain Node (no next/server): the webhook calls it and it must also be safe
 * to import from anywhere the engine reaches. Never throws into the caller's
 * status handling: the caller wraps it, and this keeps its own errors small.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { priceMessage } from './rate-card'

export interface MetaPricing {
  billable?: boolean
  pricing_model?: string
  type?: string
  category?: string
  subtype?: string
}

export interface RecordCostInput {
  accountId: string
  /** Meta's message id. */
  wamid: string
  /** The status being reported: sent, delivered, read or failed. */
  status: string
  timestamp: Date
  /** The recipient's number (the status's recipient_id). */
  recipient: string | undefined
  pricing: MetaPricing | undefined
}

export async function recordMessageCost(input: RecordCostInput): Promise<void> {
  const { accountId, wamid, status, timestamp, recipient, pricing } = input

  if (status === 'failed') {
    // A message that failed before delivery is not charged.
    await prisma.whatsAppMessageCost.updateMany({
      where: { account_id: accountId, message_id: wamid, delivered_at: null, voided_at: null },
      data: { voided_at: new Date() },
    })
    return
  }
  if (status !== 'sent' && status !== 'delivered' && status !== 'read') return

  if (pricing && (pricing.category || pricing.type)) {
    // Only a message of this business's own.
    const message = await prisma.message.findFirst({
      where: { message_id: wamid, conversation: { account_id: accountId } },
      select: {
        sender_type: true,
        sender_id: true,
        template_name: true,
        broadcast_id: true,
        conversation_id: true,
        conversation: { select: { whatsapp_config_id: true } },
      },
    })
    if (!message) {
      console.error(`[cost] ${wamid}: no message of this business with that id; pricing ignored`)
      return
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { default_currency: true },
    })
    const priced = priceMessage({
      currency: account?.default_currency,
      recipient,
      category: pricing.category,
      type: pricing.type,
      at: timestamp,
    })

    await prisma.whatsAppMessageCost.createMany({
      skipDuplicates: true,
      data: [{
        account_id: accountId,
        message_id: wamid,
        conversation_id: message.conversation_id,
        whatsapp_config_id: message.conversation?.whatsapp_config_id ?? null,
        sender_user_id: message.sender_id,
        sender_type: message.sender_type,
        template_name: message.template_name,
        broadcast_id: message.broadcast_id,
        recipient_market: priced.market,
        recipient_iso: priced.iso,
        pricing_category: pricing.category ?? null,
        pricing_type: pricing.type ?? null,
        pricing_model: pricing.pricing_model ?? null,
        pricing_subtype: pricing.subtype ?? null,
        raw_pricing: pricing as unknown as Prisma.InputJsonObject,
        amount: priced.amount,
        currency: priced.currency,
        rate_known: priced.rateKnown,
        rate_version: priced.rateVersion,
        occurred_at: timestamp,
        delivered_at: status === 'sent' ? null : timestamp,
      }],
    })
  }

  if (status === 'delivered' || status === 'read') {
    await prisma.whatsAppMessageCost.updateMany({
      where: { account_id: accountId, message_id: wamid, delivered_at: null },
      data: { delivered_at: timestamp },
    })
  }
}
