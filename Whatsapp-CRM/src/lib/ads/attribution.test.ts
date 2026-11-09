import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const h = vi.hoisted(() => ({
  touches: [] as Array<Record<string, unknown>>,
  convUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  leadUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  names: [] as string[][],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    adTouch: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.touches.some((t) => t.account_id === data.account_id && t.channel === data.channel && t.external_id === data.external_id)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
        }
        h.touches.push(data)
        return data
      },
    },
    conversation: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { h.convUpdates.push(a); return { count: 1 } } },
    lead: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { h.leadUpdates.push(a); return { count: 1 } } },
  },
}))
vi.mock('./ad-names', () => ({ ensureAdNames: async (_acc: string, ids: string[]) => { h.names.push(ids); return 0 } }))

import { recordAdTouch, referralFromMeta, referralFromWhatsApp } from './attribution'

beforeEach(() => { h.touches = []; h.convUpdates = []; h.leadUpdates = []; h.names = [] })

describe('referralFromWhatsApp', () => {
  it('a Click-to-WhatsApp ad', () => {
    expect(referralFromWhatsApp({
      source_type: 'ad', source_id: '120213456789', headline: 'Diwali offer', ctwa_clid: 'ARAk…',
      source_url: 'https://fb.me/abc', image_url: 'https://scontent.example/x.jpg',
    })).toEqual({
      adId: '120213456789', postId: null, sourceType: 'ad', headline: 'Diwali offer', clickId: 'ARAk…',
      sourceUrl: 'https://fb.me/abc', mediaUrl: 'https://scontent.example/x.jpg',
      // A short fb.me link does not say Facebook or Instagram.
      platform: null,
    })
  })

  it('a Status ad with no click id is still an ad', () => {
    expect(referralFromWhatsApp({ source_type: 'ad', source_id: '120213456789', body: 'Free demo' })).toMatchObject({ adId: '120213456789', clickId: null, headline: 'Free demo' })
  })

  it('a boosted post is a post, not an ad', () => {
    expect(referralFromWhatsApp({ source_type: 'post', source_id: '987654321012' })).toMatchObject({ adId: null, postId: '987654321012' })
  })

  it('ignores junk: no ids, non-digit ids, javascript: urls', () => {
    expect(referralFromWhatsApp({ source_type: 'ad', source_id: '../../me' })).toBeNull()
    expect(referralFromWhatsApp(null)).toBeNull()
    expect(referralFromWhatsApp({ source_type: 'ad', source_id: '120213456789', source_url: 'javascript:alert(1)' })?.sourceUrl).toBeNull()
  })
})

describe('referralFromMeta (Messenger and Instagram)', () => {
  const ad = {
    ref: 'summer', ad_id: '238510000000000', source: 'ADS', type: 'OPEN_THREAD',
    ads_context_data: { ad_title: 'Admissions open', photo_url: 'https://scontent.example/p.jpg', post_id: '111222333444' },
  }

  it('reads ad_id and ads_context_data.ad_title (not WhatsApp\'s source_id/headline)', () => {
    expect(referralFromMeta(ad)).toEqual({
      adId: '238510000000000', postId: '111222333444', sourceType: 'ad', headline: 'Admissions open',
      clickId: 'summer', sourceUrl: null, mediaUrl: 'https://scontent.example/p.jpg',
    })
  })

  it('an m.me / ig.me link or a shop page is not an ad', () => {
    expect(referralFromMeta({ ref: 'x', source: 'SHORTLINK', type: 'OPEN_THREAD' })).toBeNull()
    expect(referralFromMeta({ source: 'IGME-SOURCE-LINK', type: 'OPEN_THREAD' })).toBeNull()
    expect(referralFromMeta({ product: { id: '1' } })).toBeNull()
  })
})

describe('recordAdTouch', () => {
  const base = {
    accountId: 'acc', channel: 'instagram' as const, externalId: 'mid.1', contactId: 'c1', conversationId: 'v1',
    referral: { adId: '238510000000000', postId: null, sourceType: 'ad', headline: 'Admissions open', clickId: null, sourceUrl: null, mediaUrl: null },
  }

  it('stores the touch, fills the chat\'s ad only when empty, gives open leads without an ad this one, and asks for names', async () => {
    expect(await recordAdTouch(base)).toBe(true)
    expect(h.touches).toHaveLength(1)
    expect(h.convUpdates[0].where).toEqual({ id: 'v1', account_id: 'acc', ctwa_source_id: null })
    expect(h.leadUpdates[0].where).toEqual({ account_id: 'acc', contact_id: 'c1', ad_id: null, status: { not: 'closed' } })
    expect(h.leadUpdates[0].data).toEqual({ ad_id: '238510000000000' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.names).toEqual([['238510000000000']])
  })

  it('twice is once: Meta delivering the same message again stores nothing more', async () => {
    await recordAdTouch(base)
    expect(await recordAdTouch(base)).toBe(false)
    expect(h.touches).toHaveLength(1)
    expect(h.leadUpdates).toHaveLength(1)
  })

  it('a boosted post is recorded but gives no lead an ad', async () => {
    await recordAdTouch({ ...base, referral: { ...base.referral, adId: null, postId: '111222333444' } })
    expect(h.touches).toHaveLength(1)
    expect(h.leadUpdates).toHaveLength(0)
    expect(h.convUpdates).toHaveLength(0)
  })

  it('never throws when the database fails', async () => {
    const { prisma } = await import('@/lib/db')
    const spy = vi.spyOn(prisma.adTouch, 'create').mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await recordAdTouch(base)).toBe(false)
    spy.mockRestore()
  })
})

describe('where the ad was seen (Facebook or Instagram)', () => {
  it('a full Instagram or Facebook link says so; a short fb.me link says nothing', async () => {
    const { platformFromUrl } = await import('./attribution')
    expect(platformFromUrl('https://www.instagram.com/p/Cx1/')).toBe('instagram')
    expect(platformFromUrl('https://m.facebook.com/story.php?id=1')).toBe('facebook')
    expect(platformFromUrl('https://fb.me/3abc')).toBeNull()
    expect(platformFromUrl('https://instagram.com.evil.example/x')).toBeNull()
    expect(platformFromUrl(null)).toBeNull()
  })

  it('an ad set on one platform family is certain; both, or automatic placements, is not', async () => {
    const { platformFromPlacements } = await import('./attribution')
    expect(platformFromPlacements('instagram')).toBe('instagram')
    expect(platformFromPlacements('facebook,messenger')).toBe('facebook')
    expect(platformFromPlacements('facebook,instagram')).toBeNull()
    expect(platformFromPlacements(null)).toBeNull()
  })

  it('the click wins over the ad set; unknown stays unknown', async () => {
    const { seenOn } = await import('./attribution')
    expect(seenOn('instagram', 'facebook')).toBe('instagram')
    expect(seenOn(null, 'instagram')).toBe('instagram')
    expect(seenOn(null, 'facebook,instagram')).toBeNull()
  })

  it('a WhatsApp ad clicked on Instagram is stored as seen on Instagram', async () => {
    const ref = referralFromWhatsApp({ source_type: 'ad', source_id: '120213456789', source_url: 'https://www.instagram.com/p/Cx1/' })
    expect(ref?.platform).toBe('instagram')
    await recordAdTouch({ accountId: 'acc', channel: 'whatsapp', externalId: 'wamid.1', referral: ref!, contactId: 'c1' })
    expect(h.touches[0]).toMatchObject({ channel: 'whatsapp', platform: 'instagram' })
  })

  it('a message in Instagram Direct means they were on Instagram; Messenger alone does not decide', async () => {
    const ref = referralFromMeta({ ad_id: '238510000000000', source: 'ADS' })!
    await recordAdTouch({ accountId: 'acc', channel: 'instagram', externalId: 'ig.1', referral: ref })
    await recordAdTouch({ accountId: 'acc', channel: 'messenger', externalId: 'fb.1', referral: ref })
    expect(h.touches.map((t) => t.platform)).toEqual(['instagram', null])
  })
})
