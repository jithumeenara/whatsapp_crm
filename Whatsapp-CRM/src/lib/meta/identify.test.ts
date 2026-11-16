import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identifyInstagramToken, identifyPageToken } from './identify'

/**
 * Bugs:
 *  - Instagram Test Connection stored /me `id` (app-scoped) as the account
 *    id; webhooks carry `user_id`, so real DMs were dropped as "no config".
 *    With a Page token it stored the Page id instead.
 *  - Messenger Test Connection called any error but 190/10 a success and
 *    never checked the token belonged to the saved Page.
 */

let routes: Record<string, unknown> = {}
const seen: string[] = []
beforeEach(() => {
  routes = {}
  seen.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.push(String(url))
    const path = String(url).replace(/[?&]access_token=[^&]*/, '')
    const hit = Object.entries(routes).find(([k]) => path.startsWith(k))
    const body = hit ? hit[1] : { error: { message: 'Unsupported get request', code: 100 } }
    const status = (body as { error?: unknown }).error ? 400 : 200
    return new Response(JSON.stringify(body), { status })
  }))
})

describe('Instagram token → account', () => {
  it('Instagram Login token: the professional user_id, not the app-scoped id', async () => {
    routes['https://graph.instagram.com/v27.0/me?fields=user_id'] = { id: '2600000000000001', user_id: '17841400000000', username: 'acsti' }
    const r = await identifyInstagramToken('IGAAx')
    expect(r).toMatchObject({ ok: true, igAccountId: '17841400000000', username: 'acsti', tokenKind: 'instagram_login' })
  })

  it('System User / Unified Login token: the assigned account (the saved one if several)', async () => {
    routes['https://graph.facebook.com/v27.0/me/assigned_instagram_accounts'] = { data: [{ id: '111', username: 'a' }, { id: '222', username: 'b' }] }
    expect(await identifyInstagramToken('EAAx', '222')).toMatchObject({ ok: true, igAccountId: '222', tokenKind: 'system_user', others: 1 })
  })

  it('Page token: the Instagram account linked to the Page, with the Page id', async () => {
    routes['https://graph.facebook.com/v27.0/me?fields=id,name,instagram_business_account'] = { id: '1029', name: 'ACSTI', instagram_business_account: { id: '17841400000000', username: 'acsti' } }
    expect(await identifyInstagramToken('EAApage')).toMatchObject({ ok: true, igAccountId: '17841400000000', pageId: '1029', tokenKind: 'page' })
  })

  it('a token that sees no Instagram account, or a dead token, gives a plain reason', async () => {
    routes['https://graph.facebook.com/v27.0/me?fields=id,name,instagram_business_account'] = { id: '1029', name: 'ACSTI' }
    expect(await identifyInstagramToken('EAApage')).toMatchObject({ ok: false, error: expect.stringMatching(/cannot see an Instagram/) })
    routes = { 'https://graph.instagram.com/v27.0/me': { error: { code: 190, message: 'Invalid OAuth' } } }
    expect(await identifyInstagramToken('IGAAdead')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid any more/) })
  })

  it('the token is sent encoded, never as raw text in the path', async () => {
    routes['https://graph.instagram.com/v27.0/me?fields=user_id'] = { user_id: '1' }
    await identifyInstagramToken('IGAA a&b=c')
    expect(seen[0]).toContain('access_token=IGAA%20a%26b%3Dc')
  })
})

describe('Messenger token → Page', () => {
  it('a Page token for the saved Page', async () => {
    routes['https://graph.facebook.com/v27.0/me?fields=id,name,category'] = { id: '1029', name: 'ACSTI', category: 'Education' }
    expect(await identifyPageToken('EAApage', '1029')).toMatchObject({ ok: true, pageId: '1029', pageName: 'ACSTI', pageToken: 'EAApage', tokenKind: 'page' })
  })

  it("a token for another Page is refused (it used to 'pass')", async () => {
    routes['https://graph.facebook.com/v27.0/me?fields=id,name,category'] = { id: '5555', name: 'Other', category: 'Shop' }
    expect(await identifyPageToken('EAAother', '1029')).toMatchObject({ ok: false, error: expect.stringMatching(/another Page/) })
  })

  it("a System User token: the saved Page's own token is used", async () => {
    routes['https://graph.facebook.com/v27.0/me?fields=id,name,category'] = { id: '9001', name: 'CRM system user' }
    routes['https://graph.facebook.com/v27.0/me/accounts'] = { data: [{ id: '1029', name: 'ACSTI', access_token: 'EAApage-derived' }, { id: '2', name: 'B', access_token: 'EAAb' }] }
    expect(await identifyPageToken('EAAsys', '1029')).toMatchObject({ ok: true, pageId: '1029', pageToken: 'EAApage-derived', tokenKind: 'system_user' })
    expect(await identifyPageToken('EAAsys', null)).toMatchObject({ ok: false, error: expect.stringMatching(/several Pages/) })
  })

  it('an Instagram Login token is not a Messenger token', async () => {
    expect(await identifyPageToken('IGAAx')).toMatchObject({ ok: false })
  })
})
