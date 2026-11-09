/**
 * Which Meta ad a customer came from — one way for every channel.
 *
 * Meta tells us in the inbound webhook (the "referral" object) or in a
 * Lead Ads submission. The shapes differ by channel, so each is read into
 * one AdReferral, then recordAdTouch stores it the same way everywhere:
 *
 *   WhatsApp   messages[].referral: source_type 'ad' | 'post', source_id
 *              (the ad or post id), headline, body, image/video/thumbnail
 *              url, ctwa_clid. A Status ad may come without ctwa_clid —
 *              still an ad, still recorded.
 *   Messenger  message.referral, postback.referral (new thread) or the
 *              messaging_referrals event (existing thread): source 'ADS',
 *              ad_id, ref, ads_context_data { ad_title, photo_url,
 *              video_url, post_id }.
 *   Instagram  message.referral on a Click-to-Direct ad: same fields as
 *              Messenger (ad_id, ads_context_data.ad_title).
 *   Lead form  the leadgen webhook's ad_id.
 *
 * recordAdTouch, for each arrival:
 *   1. stores one ad_touches row — Meta's message/leadgen id is the dedupe
 *      key, so a webhook delivered twice is stored once (bug rule 6);
 *   2. fills the conversation's ad (ctwa_source_id / ctwa_ad_headline)
 *      when it has none — leadOrigin reads it when a lead is created;
 *   3. gives the contact's open leads that have no ad this one (first
 *      ad wins; later ones stay in ad_touches as the journey);
 *   4. asks for the ad's name in the background (ad-names.ts).
 * Never throws: attribution must not fail or slow a customer's message.
 *
 * Loaded by webhook routes only; no next/server here.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type AdChannel = 'whatsapp' | 'messenger' | 'instagram' | 'lead_form'

export interface AdReferral {
  adId: string | null
  postId: string | null
  sourceType: string | null
  headline: string | null
  clickId: string | null
  sourceUrl: string | null
  mediaUrl: string | null
}

/** Meta ids are digits; anything else is not trusted as an id. */
const META_ID = /^\d{5,30}$/
const id = (v: unknown): string | null => (typeof v === 'string' && META_ID.test(v.trim()) ? v.trim() : null)
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
const url = (v: unknown): string | null => {
  const t = text(v, 2000)
  return t && /^https:\/\//i.test(t) ? t : null
}
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** WhatsApp Cloud API messages[].referral. Null when it is not from an ad or post. */
export function referralFromWhatsApp(raw: unknown): AdReferral | null {
  const r = obj(raw)
  if (!r) return null
  const sourceType = text(r.source_type, 20)?.toLowerCase() ?? null
  const sourceId = id(r.source_id)
  const ref: AdReferral = {
    adId: sourceType === 'post' ? null : sourceId,
    postId: sourceType === 'post' ? sourceId : null,
    sourceType,
    headline: text(r.headline, 300) ?? text(r.body, 300),
    clickId: text(r.ctwa_clid, 500),
    sourceUrl: url(r.source_url),
    mediaUrl: url(r.image_url) ?? url(r.thumbnail_url) ?? url(r.video_url),
  }
  return ref.adId || ref.postId || ref.clickId ? ref : null
}

/** Messenger / Instagram referral (message, postback or referral event). Null unless from an ad. */
export function referralFromMeta(raw: unknown): AdReferral | null {
  const r = obj(raw)
  if (!r) return null
  const source = text(r.source, 40)?.toUpperCase() ?? null
  const ctx = obj(r.ads_context_data)
  const adId = id(r.ad_id)
  // m.me / ig.me links and Shops product pages carry a referral too; only ads count.
  if (!adId && source !== 'ADS') return null
  const ref: AdReferral = {
    adId,
    postId: id(ctx?.post_id),
    sourceType: 'ad',
    headline: text(ctx?.ad_title, 300),
    clickId: text(r.ref, 500),
    sourceUrl: url(r.referer_uri),
    mediaUrl: url(ctx?.photo_url) ?? url(ctx?.video_url),
  }
  return ref.adId || ref.postId ? ref : null
}

export interface TouchInput {
  accountId: string
  channel: AdChannel
  /** Meta's id for this arrival (message id / leadgen id): the dedupe key. */
  externalId: string
  referral: AdReferral
  contactId?: string | null
  conversationId?: string | null
  at?: Date
}

/** True when this arrival was new (not a repeat delivery). Never throws. */
export async function recordAdTouch(t: TouchInput): Promise<boolean> {
  const externalId = text(t.externalId, 300)
  if (!t.accountId || !externalId) return false
  const r = t.referral
  const at = t.at && !Number.isNaN(t.at.getTime()) ? t.at : new Date()
  try {
    try {
      await prisma.adTouch.create({
        data: {
          account_id: t.accountId,
          contact_id: t.contactId ?? null,
          conversation_id: t.conversationId ?? null,
          channel: t.channel,
          external_id: externalId,
          ad_id: r.adId,
          post_id: r.postId,
          source_type: r.sourceType,
          headline: r.headline,
          click_id: r.clickId,
          source_url: r.sourceUrl,
          media_url: r.mediaUrl,
          touched_at: at,
        },
      })
    } catch (err) {
      // Meta delivered the same event again: already recorded.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
      throw err
    }

    if (r.adId) {
      if (t.conversationId) {
        // Only when the chat has no ad yet — the first ad is the chat's origin.
        await prisma.conversation.updateMany({
          where: { id: t.conversationId, account_id: t.accountId, ctwa_source_id: null },
          data: { ctwa_source_id: r.adId, ...(r.headline ? { ctwa_ad_headline: r.headline } : {}) },
        })
      }
      if (t.contactId) {
        await prisma.lead.updateMany({
          where: { account_id: t.accountId, contact_id: t.contactId, ad_id: null, status: { not: 'closed' } },
          data: { ad_id: r.adId },
        })
      }
      // Names in the background; a slow Meta must not hold the webhook.
      void import('./ad-names')
        .then((m) => m.ensureAdNames(t.accountId, [r.adId as string]))
        .catch((err) => console.error('[ads] name lookup failed:', err instanceof Error ? err.message : err))
    }
    return true
  } catch (err) {
    console.error('[ads] ad touch not recorded:', err instanceof Error ? err.message : err)
    return false
  }
}
