import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * web-push sends through node's https, not fetch, so the development send
 * guard (which patches fetch) never saw it: a laptop or staging server
 * holding a copy of production subscriptions pushed real notifications to
 * real staff phones. It now asks the guard itself.
 */

const h = vi.hoisted(() => ({ sent: 0 }))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: () => { h.sent++; return Promise.resolve({}) },
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: {
      findMany: () => Promise.resolve([{ id: 's1', endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' }]),
      delete: () => Promise.resolve({}),
    },
  },
}))

import { sendPushToAccount, sendPushToUser } from './push'

const saved = { ...process.env }
beforeEach(() => {
  h.sent = 0
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  process.env = { ...saved }
})

describe('web push in a protected environment', () => {
  it('a development machine does not push', async () => {
    process.env.APP_ENV = 'development'
    await sendPushToUser('u1', { title: 't', body: 'b' })
    await sendPushToAccount('acc', { title: 't', body: 'b' })
    expect(h.sent).toBe(0)
  })

  it('production still pushes', async () => {
    process.env.APP_ENV = 'production'
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    delete process.env.VITEST
    await sendPushToUser('u1', { title: 't', body: 'b' })
    expect(h.sent).toBe(1)
  })
})
