/**
 * Turns an inbound WhatsApp `order` message into an Order row and,
 * optionally, an auto-created Deal. Fire-and-forget from the webhook
 * handler (see processMessage in src/app/api/whatsapp/webhook/route.ts) —
 * same shape as transcribeInboundAudio: never blocks the webhook's
 * ack-and-return, never throws.
 *
 * WhatsApp's cart is entirely native to the customer's own app — there is
 * no cart API to call. This module only ever sees the finished order.
 */
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import type { Prisma } from '@prisma/client'

interface InboundOrderItem {
  product_retailer_id: string
  quantity: string
  item_price?: string
  currency?: string
}

export async function processInboundOrder(args: {
  accountId: string
  waMessageId: string
  messageId: string
  contactId: string
  conversationId: string
  order: { catalog_id: string; product_items: InboundOrderItem[]; text?: string }
}): Promise<void> {
  try {
    // Idempotency — a webhook can redeliver the same event.
    const existing = await prisma.order.findUnique({ where: { wa_message_id: args.waMessageId } })
    if (existing) return

    const retailerIds = args.order.product_items.map((it) => it.product_retailer_id)
    const localProducts = retailerIds.length
      ? await prisma.product.findMany({
          where: { account_id: args.accountId, retailer_id: { in: retailerIds } },
        })
      : []
    const productByRetailerId = new Map(localProducts.map((p) => [p.retailer_id, p]))

    let currency: string | null = null
    let subtotal = 0
    const items = args.order.product_items.map((it) => {
      const quantity = parseInt(it.quantity, 10) || 0
      // item_price from the webhook is authoritative at order time — the
      // Product's current price may have changed since; fall back to it
      // only when Meta didn't send a price on the item itself.
      const local = productByRetailerId.get(it.product_retailer_id)
      const priceRaw = it.item_price ?? (local?.price != null ? String(local.price) : undefined)
      const price = priceRaw ? parseFloat(priceRaw) : 0
      if (it.currency && !currency) currency = it.currency
      else if (local?.currency && !currency) currency = local.currency
      subtotal += price * quantity
      return {
        retailer_id: it.product_retailer_id,
        quantity,
        item_price: price,
        name: local?.name ?? it.product_retailer_id,
      }
    })

    const order = await prisma.order.create({
      data: {
        account_id: args.accountId,
        wa_message_id: args.waMessageId,
        message_id: args.messageId,
        contact_id: args.contactId,
        conversation_id: args.conversationId,
        catalog_id: args.order.catalog_id,
        currency,
        items: items as unknown as Prisma.InputJsonValue,
        subtotal,
        raw_payload: args.order as unknown as Prisma.InputJsonValue,
      },
    })

    let dealId: string | null = null
    const config = await prisma.catalogConfig.findUnique({ where: { account_id: args.accountId } })
    // Opt-in — no default pipeline/stage configured means the Order still
    // lands, just without an auto-created Deal. Nothing else in this
    // codebase auto-creates a Deal today, so this stays a deliberate choice
    // rather than a forced default.
    if (config?.default_pipeline_id && config?.default_stage_id) {
      const contact = await prisma.contact.findUnique({ where: { id: args.contactId }, select: { name: true, phone: true } })
      const deal = await prisma.deal.create({
        data: {
          account_id: args.accountId,
          user_id: config.user_id,
          pipeline_id: config.default_pipeline_id,
          stage_id: config.default_stage_id,
          contact_id: args.contactId,
          conversation_id: args.conversationId,
          title: `WhatsApp Order — ${contact?.name || contact?.phone || 'Customer'}`,
          value: subtotal,
          currency: currency || 'USD',
          source: 'whatsapp_order',
        },
      })
      dealId = deal.id
      await prisma.order.update({ where: { id: order.id }, data: { deal_id: deal.id, status: 'converted' } })
    }

    const orderSnapshot = { items, subtotal, currency, deal_id: dealId }
    const updatedMessage = await prisma.message.update({
      where: { id: args.messageId },
      data: { order_snapshot: orderSnapshot as unknown as Prisma.InputJsonValue },
    })
    emitToAccount(args.accountId, 'message', { eventType: 'UPDATE', new: updatedMessage, old: {} })
  } catch (err) {
    console.error('[order-processing] failed:', err instanceof Error ? err.message : err)
  }
}
