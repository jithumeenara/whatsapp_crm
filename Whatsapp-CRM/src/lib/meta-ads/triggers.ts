import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendBusinessMessagingEvent, type BusinessMessagingEventName } from './api'

/**
 * Reports one real pipeline outcome (a lead qualifying, a deal closing)
 * back to Meta via the Conversions API for Business Messaging — the
 * whole point of Click-to-WhatsApp attribution: telling Meta's ad
 * delivery "this ad produced a real result," not just a click.
 *
 * Best-effort and silent by design, same convention as the Facebook/
 * Instagram auto-discovery in the embedded-signup route: never throws,
 * never blocks or fails the caller's own request. Does nothing (not an
 * error — the normal case) whenever:
 *   - This account hasn't connected Meta Ads, or the dataset isn't ready yet
 *   - The contact has no WhatsApp conversation with a stored ctwa_clid
 *     (i.e. they didn't come from a Click-to-WhatsApp ad at all)
 */
export async function reportMetaAdsOutcome(args: {
  accountId: string
  contactId: string | null | undefined
  eventName: BusinessMessagingEventName
  customData?: { currency?: string; value?: number }
}): Promise<void> {
  if (!args.contactId) return
  try {
    const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: args.accountId } })
    if (!config || config.status !== 'connected' || !config.dataset_id) return

    const conversation = await prisma.conversation.findFirst({
      where: {
        account_id: args.accountId,
        contact_id: args.contactId,
        channel: 'whatsapp',
        ctwa_clid: { not: null },
      },
      orderBy: { created_at: 'desc' },
      select: { ctwa_clid: true },
    })
    if (!conversation?.ctwa_clid) return

    const accessToken = decrypt(config.access_token)
    await sendBusinessMessagingEvent({
      datasetId: config.dataset_id,
      accessToken,
      eventName: args.eventName,
      eventTime: Math.floor(Date.now() / 1000),
      wabaId: config.waba_id,
      ctwaClid: conversation.ctwa_clid,
      customData: args.customData,
    })
  } catch (err) {
    console.error(`[meta-ads] failed to report ${args.eventName} (non-fatal):`, err)
  }
}
