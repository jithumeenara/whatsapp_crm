import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 0), contact: { findFirst: vi.fn(async () => null) } } }))

import { prisma } from '@/lib/db'
import { cleanText, META_ID, privateReplyOpen, safePermalink, saveIncomingComment, loadComment } from './social-comments'

describe('comment safety helpers', () => {
  it('Meta ids: digits, or digits_digits; nothing that could change a Graph URL', () => {
    for (const ok of ['17895695668004550', '123456_789012']) expect(META_ID.test(ok)).toBe(true)
    for (const bad of ['../me/accounts', '123/replies', '123?fields=x', '', 'abc', '1_2_3']) expect(META_ID.test(bad)).toBe(false)
  })

  it('reply text: a string, trimmed, hidden characters removed, length capped', () => {
    expect(cleanText('  hi\u0000 there \u0007 ', 100)).toEqual({ ok: true, text: 'hi there' })
    expect(cleanText({ text: 'x' }, 100).ok).toBe(false)
    expect(cleanText('   ', 100).ok).toBe(false)
    expect(cleanText('x'.repeat(101), 100).ok).toBe(false)
    expect(cleanText('😀'.repeat(100), 100).ok).toBe(true)
  })

  it('post links: only https instagram.com / facebook.com', () => {
    expect(safePermalink('https://www.instagram.com/p/abc/')).toBe('https://www.instagram.com/p/abc/')
    expect(safePermalink('https://www.facebook.com/123/posts/456')).toMatch(/^https:\/\/www\.facebook\.com\//)
    for (const bad of ['javascript:alert(1)', 'http://www.instagram.com/p/a', 'https://instagram.com.evil.example/p', 'https://user:pw@www.facebook.com/', 'https://evil.example/?u=instagram.com', 42]) {
      expect(safePermalink(bad)).toBeNull()
    }
  })

  it('private reply window: once, within 7 days, not on a removed comment', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    const day = 86_400_000
    expect(privateReplyOpen({ commented_at: new Date(now.getTime() - 6 * day), private_reply_at: null, deleted_at: null }, now)).toBe(true)
    expect(privateReplyOpen({ commented_at: new Date(now.getTime() - 8 * day), private_reply_at: null, deleted_at: null }, now)).toBe(false)
    expect(privateReplyOpen({ commented_at: now, private_reply_at: now, deleted_at: null }, now)).toBe(false)
    expect(privateReplyOpen({ commented_at: now, private_reply_at: null, deleted_at: now }, now)).toBe(false)
  })

  it('a webhook comment with a non-Meta id is never saved', async () => {
    vi.mocked(prisma.$queryRaw).mockClear()
    expect(await saveIncomingComment({ accountId: 'a', channel: 'instagram', commentId: '1/../../x' })).toBeNull()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('a comment id from the URL that is not a uuid is not even looked up', async () => {
    vi.mocked(prisma.$queryRaw).mockClear()
    expect(await loadComment('acc', "1' OR '1'='1")).toBeNull()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
