import { describe, expect, it, vi } from 'vitest'

/**
 * Uploads were stored as `<Date.now()>-<original name>`: a name anybody
 * who knows roughly when a file was sent, and what it was called, can
 * reconstruct. Several send paths read /api/files/... paths from disk
 * without an account check (see findings), so a guessable name is a
 * readable file. Stored names are random now (AGENTS.md rule 6).
 */

const h = vi.hoisted(() => ({ names: [] as string[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'agent' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('fs/promises', () => ({
  mkdir: () => Promise.resolve(),
  writeFile: (p: string) => { h.names.push(p); return Promise.resolve() },
}))
vi.mock('@/lib/db', () => ({
  prisma: { fileUpload: { create: (a: { data: object }) => Promise.resolve({ id: 'f1', ...a.data }) } },
}))

import { POST } from './route'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('POST /api/upload', () => {
  it('stores the file under a random, unguessable name', async () => {
    const fd = new FormData()
    fd.set('file', new File([png], 'passport.png', { type: 'image/png' }))
    const res = await POST(new Request('http://x', { method: 'POST', body: fd }) as never)
    expect(res.status).toBe(200)
    const { filename } = await res.json()
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-passport\.png$/)
  })
})
