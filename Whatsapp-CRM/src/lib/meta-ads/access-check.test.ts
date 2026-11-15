import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkMetaAdsAccess, cleanAdAccountId, cleanWabaId, explainMetaProblem } from './access-check'

const NOT_VISIBLE = "Unsupported get request. Object with ID '1405789678017778' does not exist, cannot be loaded due to missing permissions, or does not support this operation."

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

/** Answers by what the URL asks for: me, act_…, or the WABA id. */
function stubMeta(routes: { me?: [number, unknown]; ad?: [number, unknown]; waba?: [number, unknown] }) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    const pick = u.includes('/me?') ? routes.me : u.includes('/act_') ? routes.ad : routes.waba
    if (!pick) throw new Error(`unexpected ${u}`)
    return reply(pick[0], pick[1])
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('cleaning the ids', () => {
  it('puts act_ on an ad account and refuses anything that is not digits', () => {
    expect(cleanAdAccountId(' 3406716452946977 ')).toBe('act_3406716452946977')
    expect(cleanAdAccountId('act_3406716452946977')).toBe('act_3406716452946977')
    expect(cleanAdAccountId('act_12/../x')).toBeNull()
    expect(cleanAdAccountId('')).toBeNull()
    expect(cleanAdAccountId(42)).toBeNull()
  })
  it('accepts only digits for a WhatsApp account', () => {
    expect(cleanWabaId('1405789678017778')).toBe('1405789678017778')
    expect(cleanWabaId('abc?fields=x')).toBeNull()
  })
})

describe('explaining what Meta said', () => {
  it('names the Meta screen to fix when the ad account is not visible', () => {
    const text = explainMetaProblem('ad_account', { code: 100, message: NOT_VISIBLE }, 'act_1')
    expect(text).toContain('Add assets')
    expect(text).toContain('ads_read')
    expect(text).not.toContain('Unsupported get request')
  })
  it('says the WhatsApp account can be left empty', () => {
    expect(explainMetaProblem('waba', { code: 100, message: NOT_VISIBLE }, '1405789678017778')).toContain('leave it empty')
  })
  it('says a dead token is a dead token whatever the asset', () => {
    expect(explainMetaProblem('ad_account', { code: 190, message: 'Error validating access token' })).toContain('expired or not valid')
  })
  it('says wait when Meta is limiting', () => {
    expect(explainMetaProblem('waba', { code: 17, message: 'User request limit reached' })).toContain('Wait a minute')
  })
})

describe('checking a connection', () => {
  it('connects on the ad account alone when the WhatsApp account is not given', async () => {
    stubMeta({ me: [200, { id: '1' }], ad: [200, { id: 'act_3406716452946977', name: 'Acsti Ads', currency: 'INR' }] })
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: 'act_3406716452946977', wabaId: null })
    expect(r.ok).toBe(true)
    expect(r.message).toContain('Acsti Ads')
    expect(r.message).toContain('INR')
  })

  it('still connects when the WhatsApp account cannot be seen but the ad account can, and says so', async () => {
    stubMeta({
      me: [200, { id: '1' }],
      ad: [200, { id: 'act_3406716452946977', name: 'Acsti Ads', currency: 'INR' }],
      waba: [400, { error: { code: 100, message: NOT_VISIBLE } }],
    })
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: 'act_3406716452946977', wabaId: '1405789678017778' })
    expect(r.ok).toBe(true)
    expect(r.waba?.ok).toBe(false)
    expect(r.message).toContain('The WhatsApp account was not saved')
  })

  it('refuses a WhatsApp account it cannot see when there is no ad account, in plain words', async () => {
    stubMeta({ me: [200, { id: '1' }], waba: [400, { error: { code: 100, message: NOT_VISIBLE } }] })
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: null, wabaId: '1405789678017778' })
    expect(r.ok).toBe(false)
    expect(r.blocking).toContain('Add assets')
  })

  it('refuses an ad account the token cannot see, even when the WhatsApp account works', async () => {
    stubMeta({
      me: [200, { id: '1' }],
      ad: [400, { error: { code: 100, message: NOT_VISIBLE } }],
      waba: [200, { id: '1405789678017778', name: 'Acsti' }],
    })
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: 'act_3406716452946977', wabaId: '1405789678017778' })
    expect(r.ok).toBe(false)
    expect(r.blocking).toContain('Manage ad account')
  })

  it('reports an expired token once', async () => {
    const dead = [400, { error: { code: 190, message: 'Error validating access token: Session has expired' } }] as [number, unknown]
    stubMeta({ me: dead, ad: dead })
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: 'act_3406716452946977', wabaId: null })
    expect(r.ok).toBe(false)
    expect(r.blocking).toContain('expired or not valid')
  })

  it('asks for an ad account when nothing was given', async () => {
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: null, wabaId: null })
    expect(r.ok).toBe(false)
    expect(r.blocking).toContain('ad account ID')
  })

  it('says it could not reach Meta, without a raw error, when the network fails', async () => {
    // The failure here is made up by this test; keep it out of the run's log.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND graph.facebook.com'))))
    const r = await checkMetaAdsAccess({ accessToken: 't', adAccountId: 'act_3406716452946977', wabaId: null })
    expect(r.ok).toBe(false)
    expect(r.blocking).not.toContain('ENOTFOUND')
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })
})
