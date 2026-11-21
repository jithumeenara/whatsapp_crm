import { describe, expect, it, vi } from 'vitest'

// server.ts loads the scheduled-post job. Anything in its import graph that
// pulls in next/server crashes the server at start-up while the build still
// passes. This fails instead.
vi.mock('next/server', () => {
  throw new Error('next/server was imported from the server.ts publishing graph')
})

describe('the scheduled-post job stays loadable from server.ts', () => {
  it('neither social-publish nor what it loads imports next/server', async () => {
    await expect(import('./social-publish')).resolves.toBeTruthy()
  }, 120_000)
})
