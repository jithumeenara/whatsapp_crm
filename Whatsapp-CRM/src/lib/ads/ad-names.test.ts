import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  catalog: [] as Array<{ ad_id: string; fetched_at: Date; error: string | null }>,
  upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>,
  config: { status: 'connected', access_token: 'enc' } as { status: string; access_token: string } | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    adCatalog: {
      findMany: async () => h.catalog,
      upsert: async (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => { h.upserts.push(a); return a.create },
    },
    metaAdsConfig: { findUnique: async () => h.config },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain-${v}` }))

import { ensureAdNames, namesFromGraph, NO_ACCESS, NO_CONNECTION } from './ad-names'

const NOW = new Date('2026-11-09T10:00:00Z')
const AD = '120213456789'
const graphAd = {
  id: AD, name: 'Diwali offer', effective_status: 'ACTIVE',
  adset: { id: '555', name: 'Kerala 18-35', targeting: { publisher_platforms: ['instagram'] } }, campaign: { id: '777', name: 'November leads' },
  creative: { thumbnail_url: 'https://scontent.example/t.jpg' },
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  h.catalog = []; h.upserts = []; h.config = { status: 'connected', access_token: 'enc' }
  fetchMock = vi.fn(async () => new Response(JSON.stringify(graphAd), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('namesFromGraph', () => {
  it('reads ad, ad set, campaign and thumbnail', () => {
    expect(namesFromGraph(graphAd)).toEqual({
      adName: 'Diwali offer', adsetId: '555', adsetName: 'Kerala 18-35', campaignId: '777', campaignName: 'November leads',
      thumbnailUrl: 'https://scontent.example/t.jpg', effectiveStatus: 'ACTIVE', platforms: 'instagram',
    })
    expect(namesFromGraph({ id: AD })).toBeNull()
  })
})

describe('ensureAdNames', () => {
  it('looks up a new ad once, with the token in a header (never in the URL)', async () => {
    expect(await ensureAdNames('acc', [AD, AD, 'not-an-id'], NOW)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(u).toContain(`/${AD}?fields=`)
    expect(u).not.toContain('plain-enc')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer plain-enc')
    expect(h.upserts[0].create).toMatchObject({ account_id: 'acc', ad_id: AD, ad_name: 'Diwali offer', campaign_name: 'November leads', platforms: 'instagram', error: null })
    expect(decodeURIComponent(u)).toContain('targeting{publisher_platforms}')
  })

  it('a name read this week is not asked for again', async () => {
    h.catalog = [{ ad_id: AD, fetched_at: new Date(NOW.getTime() - 3 * 86_400_000), error: null }]
    expect(await ensureAdNames('acc', [AD], NOW)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no ad account connected: records why, calls nobody', async () => {
    h.config = null
    await ensureAdNames('acc', [AD], NOW)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.upserts[0].create).toMatchObject({ error: NO_CONNECTION, ad_name: null })
  })

  it('Meta refuses: records why, and a refusal never wipes names found before', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{}}', { status: 400 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await ensureAdNames('acc', [AD], NOW)
    expect(h.upserts[0].create).toMatchObject({ error: NO_ACCESS })

    h.upserts = []
    h.catalog = [{ ad_id: AD, fetched_at: new Date(NOW.getTime() - 8 * 86_400_000), error: null }]
    await ensureAdNames('acc', [AD], NOW)
    expect(h.upserts[0].update).toEqual({ fetched_at: NOW })
  })
})
