import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@/lib/whatsapp/encryption'

/**
 * Chatbot / flow sends (meta-send.ts):
 *
 * 1. Instagram page tokens are sealed on save (A8-09). The Instagram
 *    senders here read the column as it was and handed the ciphertext to
 *    the Graph API, so every bot reply on Instagram failed once a token
 *    was saved again.
 * 2. A local `/api/files/...` media link was read from disk with only an
 *    "inside uploads/" check: a member of account A could make the bot
 *    send account B's stored file (`/api/files/account-B/...`) — A3-22 /
 *    A8-04. The send must be refused before the file is read.
 */

const h = vi.hoisted(() => ({
  channel: 'whatsapp' as string,
  igToken: '',
  fetchUrls: [] as string[],
  read: [] as string[],
  uploaded: 0,
  templateArgs: [] as Array<Record<string, unknown>>,
}))

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, readFile: vi.fn(async (p: string) => { h.read.push(String(p)); return Buffer.from('file') }) }
})
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  NoWhatsAppConfigError: class extends Error {},
  resolveWhatsAppConfig: async () => ({ phone_number_id: 'pn', access_token: sealSecret('wa-token') }),
}))
vi.mock('@/lib/whatsapp/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/meta-api')>('@/lib/whatsapp/meta-api')
  return {
    ...actual,
    uploadMediaToMeta: vi.fn(async () => { h.uploaded++; return 'media-id' }),
    sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.1' })),
    sendTemplateMessage: vi.fn(async (a: Record<string, unknown>) => { h.templateArgs.push(a); return { messageId: 'wamid.2' } }),
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      const rows = sql.includes('instagram_config')
        ? [{ access_token: h.igToken }]
        : sql.includes('conversations')
          ? [{ channel: h.channel }]
          : []
      const p = Promise.resolve(rows)
      return { catch: () => p, then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => p.then(r, j) }
    },
    contact: { findFirst: async () => ({ id: 'c1', phone: h.channel === 'instagram' ? '17841400000000' : '+14155550100' }) },
    message: { create: async () => ({ id: 'msg' }) },
    conversation: { update: async () => ({}) },
    messageTemplate: { findFirst: async () => null },
  },
}))

import { engineSendMedia, engineSendText, engineSendTemplate } from './meta-send'

const base = { accountId: 'acc-a', userId: 'u', conversationId: '00000000-0000-0000-0000-000000000001', contactId: 'c1' }

beforeEach(() => {
  h.fetchUrls = []
  h.read = []
  h.uploaded = 0
  h.templateArgs = []
  h.igToken = sealSecret('real-ig-token')!
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    h.fetchUrls.push(String(url))
    return new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 })
  }))
})

describe('meta-send: sealed Instagram token', () => {
  it('a bot text reply on Instagram reaches the Graph API with the decrypted token', async () => {
    h.channel = 'instagram'
    await engineSendText({ ...base, text: 'hi' })
    const sends = h.fetchUrls.filter((u) => u.includes('/me/messages'))
    expect(sends.length).toBeGreaterThan(0)
    for (const u of sends) expect(new URL(u).searchParams.get('access_token')).toBe('real-ig-token')
  })

  it('an Instagram media send uses the decrypted token too', async () => {
    h.channel = 'instagram'
    await engineSendMedia({ ...base, kind: 'image', link: 'https://example.com/a.jpg' })
    const sends = h.fetchUrls.filter((u) => u.includes('/me/messages'))
    expect(sends.length).toBeGreaterThan(0)
    for (const u of sends) expect(new URL(u).searchParams.get('access_token')).toBe('real-ig-token')
  })
})

describe('meta-send: another account’s stored file', () => {
  it('WhatsApp: refuses /api/files/account-<other>/… and reads nothing', async () => {
    h.channel = 'whatsapp'
    await expect(engineSendMedia({ ...base, kind: 'image', link: '/api/files/account-acc-b/secret.jpg' })).rejects.toThrow()
    expect(h.read).toEqual([])
    expect(h.uploaded).toBe(0)
  })

  it('WhatsApp: ../ cannot walk from this account into another', async () => {
    h.channel = 'whatsapp'
    await expect(engineSendMedia({ ...base, kind: 'image', link: '/api/files/account-acc-a/../account-acc-b/secret.jpg' })).rejects.toThrow()
    expect(h.read).toEqual([])
  })

  it('WhatsApp: this account’s own file is still sent', async () => {
    h.channel = 'whatsapp'
    await engineSendMedia({ ...base, kind: 'image', link: '/api/files/account-acc-a/mine.jpg' })
    expect(h.read).toHaveLength(1)
    expect(h.uploaded).toBe(1)
  })

  it('Instagram: refuses another account’s file and posts nothing', async () => {
    h.channel = 'instagram'
    await expect(engineSendMedia({ ...base, kind: 'image', link: '/api/files/account-acc-b/secret.jpg' })).rejects.toThrow()
    expect(h.read).toEqual([])
    expect(h.fetchUrls).toEqual([])
  })

  it('templates: the sending account is passed so a header file is checked against it', async () => {
    h.channel = 'whatsapp'
    await engineSendTemplate({ ...base, templateName: 't', headerMediaUrl: '/api/files/account-acc-b/x.jpg' } as never)
    expect(h.templateArgs[0]?.accountId).toBe('acc-a')
  })
})
