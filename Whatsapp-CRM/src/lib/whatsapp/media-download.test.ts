import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadMedia, getMediaUrl } from './meta-api'

/**
 * Bug (security audit 2026-10): GET /api/whatsapp/media/<id> put the id
 * straight into a Graph path (any signed-in member, even a viewer, could
 * send "me?fields=…" or "<other-object>" with the account's WhatsApp
 * token), and downloadMedia sent that token as a Bearer header to
 * whatever `url` the answer held. The id must be a media id, and the
 * token is only sent to Meta's own media hosts.
 */

const calls: Array<{ url: string; auth: string | null }> = []
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  calls.length = 0
})

function stub(answer: unknown) {
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
    return Response.json(answer)
  }) as unknown as typeof fetch
}

describe('WhatsApp media — ids and hosts', () => {
  it('refuses anything that is not a media id, before calling Graph', async () => {
    stub({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg' })
    for (const id of ['me?fields=id', '123/subscribed_apps', '../v1/123', '123#x', '']) {
      await expect(getMediaUrl({ mediaId: id, accessToken: 't' }), id).rejects.toThrow()
    }
    expect(calls).toHaveLength(0)
  })

  it('looks up a real media id', async () => {
    stub({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg' })
    const info = await getMediaUrl({ mediaId: '1234567890123456', accessToken: 't' })
    expect(info.url).toContain('lookaside.fbsbx.com')
  })

  it('never sends the token to a host that is not Meta’s', async () => {
    stub({})
    for (const url of ['https://evil.example/x', 'http://lookaside.fbsbx.com/x', 'https://fbsbx.com.evil.example/x', 'https://169.254.169.254/']) {
      await expect(downloadMedia({ downloadUrl: url, accessToken: 'secret-token' }), url).rejects.toThrow()
    }
    expect(calls).toHaveLength(0)
  })

  it('downloads from Meta’s media host', async () => {
    stub({})
    await downloadMedia({ downloadUrl: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', accessToken: 't' })
    expect(calls[0].auth).toBe('Bearer t')
  })
})
