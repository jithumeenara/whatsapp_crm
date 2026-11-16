import { describe, expect, it, vi } from 'vitest'

// server.ts loads the Messenger/Instagram health sweep. Anything in its
// import graph that pulls in next/server crashes the server at start-up
// while the build still passes. This fails instead.
vi.mock('next/server', () => {
  throw new Error('next/server was imported from the server.ts sweep graph')
})

describe('the social connection sweep stays loadable from server.ts', () => {
  it('neither the sweep nor what it loads imports next/server', async () => {
    await expect(import('./social-health-sweep')).resolves.toBeTruthy()
  }, 120_000)
})
