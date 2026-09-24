import { describe, it, expect, vi, beforeEach } from 'vitest'

const flow = vi.hoisted(() => ({ findFirst: vi.fn() }))
const requireRole = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { flow } }))
class UnauthorizedError extends Error {}
vi.mock('@/lib/auth/account', async () => {
  const { NextResponse } = await import('next/server')
  return {
    requireRole,
    toErrorResponse: (err: unknown) =>
      NextResponse.json({ error: 'nope' }, { status: err instanceof UnauthorizedError ? 401 : 500 }),
  }
})

import { maskAadhaar, debugLog } from './webhook-handler'
import { GET } from '@/app/api/flows/[id]/webhook/route'

describe('maskAadhaar', () => {
  it('shows only the last four digits, the way UIDAI masks it', () => {
    expect(maskAadhaar('1234 5678 9012')).toBe('XXXX XXXX 9012')
    expect(maskAadhaar('123456789012')).toBe('XXXX XXXX 9012')
  })
  it('never passes a longer value through whole', () => {
    expect(maskAadhaar('ABCD12345')).toBe('XXXXX2345')
    expect(maskAadhaar('12')).toBe('12')
  })
})

describe('Flow debug log', () => {
  const call = (id: string) =>
    GET(new Request(`https://x.test/api/flows/${id}/webhook?debug=1`), { params: Promise.resolve({ id }) })

  beforeEach(() => {
    vi.clearAllMocks()
    debugLog.set('flow-1', [{ ts: 'now', action: 'x', screen: 's', formData: { aadhaar: '123456789012' } } as never])
  })

  it('is closed to anyone not signed in', async () => {
    requireRole.mockRejectedValue(new UnauthorizedError('no session'))
    const res = await call('flow-1')
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('123456789012')
  })

  it("is closed to another account's admin", async () => {
    requireRole.mockResolvedValue({ accountId: 'other', userId: 'u', role: 'admin' })
    flow.findFirst.mockResolvedValue(null)
    const res = await call('flow-1')
    expect(res.status).toBe(404)
  })

  it("opens for the owning account's admin", async () => {
    requireRole.mockResolvedValue({ accountId: 'acc', userId: 'u', role: 'admin' })
    flow.findFirst.mockResolvedValue({ id: 'flow-1' })
    const res = await call('flow-1')
    expect(res.status).toBe(200)
    expect(flow.findFirst.mock.calls[0][0].where).toEqual({ id: 'flow-1', account_id: 'acc' })
  })
})
