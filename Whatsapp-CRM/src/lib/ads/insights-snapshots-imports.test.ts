import { describe, expect, it, vi } from 'vitest'

// server.ts loads the daily ad-spend copy job. Anything in its import graph
// that pulls in next/server crashes the server at start-up while the build
// still passes. This fails instead.
vi.mock('next/server', () => {
  throw new Error('next/server was imported from the server.ts ad-snapshots graph')
})

describe('the ad-spend copy job stays loadable from server.ts', () => {
  it('neither insights-snapshots nor what it loads imports next/server', async () => {
    await expect(import('./insights-snapshots')).resolves.toBeTruthy()
  }, 120_000)
})
