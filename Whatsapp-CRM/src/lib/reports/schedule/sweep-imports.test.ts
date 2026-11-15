import { describe, expect, it, vi } from 'vitest'

// server.ts loads the scheduled-report sweep. Anything in its import graph
// that pulls in next/server (or the rate limiter, which does) crashes the
// server at start-up while the build still passes. This fails instead.
vi.mock('next/server', () => {
  throw new Error('next/server was imported from the server.ts sweep graph')
})

describe('the scheduled-report sweep stays loadable from server.ts', () => {
  it('neither the sweep nor what it loads at send time imports next/server', async () => {
    await expect(import('./sweep')).resolves.toBeTruthy()
    await expect(import('../alerts/sweep')).resolves.toBeTruthy()
    await expect(import('@/lib/admin-chat/brief-sweep')).resolves.toBeTruthy()
    await expect(import('@/lib/messaging/channels/email')).resolves.toBeTruthy()
    await expect(import('../doc/pdf')).resolves.toBeTruthy()
    await expect(import('../doc/business')).resolves.toBeTruthy()
    await expect(import('../pdf/build-slots')).resolves.toBeTruthy()
  }, 120_000)
})
