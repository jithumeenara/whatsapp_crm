import { beforeEach, describe, expect, it, vi } from 'vitest'

// Quick Connect of a number that was connected before generated a new
// random PIN every time, and Meta refused it: "Two step verification PIN
// mismatch" (133005). Now the kept PIN is reused, and a mismatch sets a new
// PIN with the business token and registers once more.

const h = vi.hoisted(() => ({
  kept: null as string | null,
  metaPin: '111111' as string | null,
  registered: [] as string[],
  pinSet: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: async () => [{ pin: h.kept ? `sealed:${h.kept}` : null }], $executeRaw: async () => 1 },
}))
vi.mock('@prisma/client', () => ({ Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (v: string) => `sealed:${v}`, decrypt: (v: string) => v.replace('sealed:', '') }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  isPinMismatch: (e: { metaCode?: number }) => e?.metaCode === 133005,
  registerPhoneNumber: async ({ pin }: { pin: string }) => {
    h.registered.push(pin)
    if (h.metaPin && pin !== h.metaPin) throw Object.assign(new Error('Two step verification PIN Mismatch'), { metaCode: 133005 })
    return { success: true, alreadyRegistered: false }
  },
  setTwoStepPin: async ({ pin }: { pin: string }) => { h.pinSet.push(pin); h.metaPin = pin },
}))

import { registerWithPin } from './two-step-pin'

const ARGS = { accountId: 'acc', phoneNumberId: '123', accessToken: 'tok' }

beforeEach(() => { h.kept = null; h.metaPin = '111111'; h.registered = []; h.pinSet = [] })

describe('registerWithPin', () => {
  it('uses the PIN kept from the last connect', async () => {
    h.kept = '111111'
    expect(await registerWithPin(ARGS)).toBe('111111')
    expect(h.registered).toEqual(['111111'])
    expect(h.pinSet).toEqual([])
  })

  it('a number registered before with an unknown PIN still connects', async () => {
    const pin = await registerWithPin(ARGS)
    expect(h.pinSet).toHaveLength(1)
    expect(pin).toBe(h.pinSet[0])
    expect(h.registered.at(-1)).toBe(pin)
    expect(pin).toMatch(/^\d{6}$/)
  })

  it('any other Meta error is passed on', async () => {
    h.metaPin = null
    const other = await import('@/lib/whatsapp/meta-api')
    vi.spyOn(other, 'registerPhoneNumber').mockRejectedValueOnce(Object.assign(new Error('Number is registered to another app'), { metaCode: 133010 }))
    await expect(registerWithPin(ARGS)).rejects.toThrow(/another app/)
    expect(h.pinSet).toEqual([])
  })
})
