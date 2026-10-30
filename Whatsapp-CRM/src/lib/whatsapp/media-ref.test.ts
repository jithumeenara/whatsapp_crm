import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): sending a stored file took any
 * /api/files/... path. An agent of account A could send
 * /api/files/account-<B>/<id-card>.jpg to their own WhatsApp number and
 * receive account B's file — the per-account folder rule that the file
 * route enforces was not applied on the send path. Traversal such as
 * account-<A>/../account-<B>/x slipped past the Telegram check too.
 */

const h = vi.hoisted(() => ({ reads: [] as string[], uploads: 0 }))
vi.mock('fs/promises', () => ({
  readFile: async (p: string) => {
    h.reads.push(p)
    return Buffer.from('bytes')
  },
}))
vi.mock('./meta-api', () => ({
  uploadMediaToMeta: async () => {
    h.uploads++
    return 'media-1'
  },
}))

import { resolveMediaRef } from './media-ref'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('sending a stored file — only the sender account’s own', () => {
  beforeEach(() => {
    h.reads = []
    h.uploads = 0
  })

  it("refuses another account's file", async () => {
    await expect(resolveMediaRef(`/api/files/account-${B}/id-card.jpg`, 'pn', 't', A)).rejects.toThrow()
    expect(h.reads).toHaveLength(0)
  })

  it('refuses traversal into another account’s folder', async () => {
    for (const link of [
      `/api/files/account-${A}/../account-${B}/id-card.jpg`,
      `/api/files/./account-${B}/id-card.jpg`,
      `/api/files/account-${A}%2F..%2Faccount-${B}/x.jpg`,
      `/api/files/../uploads-other/x.jpg`,
      `/api/files/../../etc/passwd`,
    ]) {
      await expect(resolveMediaRef(link, 'pn', 't', A), link).rejects.toThrow()
    }
    expect(h.reads).toHaveLength(0)
  })

  it('sends its own file', async () => {
    const ref = await resolveMediaRef(`/api/files/account-${A}/photo.jpg`, 'pn', 't', A)
    expect(ref).toEqual({ id: 'media-1' })
  })

  it('passes a public https link through untouched', async () => {
    expect(await resolveMediaRef('https://example.com/a.jpg', 'pn', 't', A)).toEqual({ link: 'https://example.com/a.jpg' })
  })
})
