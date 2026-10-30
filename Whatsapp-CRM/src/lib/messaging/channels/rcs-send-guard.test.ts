import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): the Twilio SDK sends over axios, not
 * fetch, so the central send guard never saw an RCS/SMS send — a test,
 * preview or staging server delivered real texts to customers.
 */

const create = vi.fn(async () => ({ sid: 'SMreal' }))
vi.mock('twilio', () => {
  const factory = Object.assign(() => ({ messages: { create } }), { validateRequest: () => true })
  return { default: factory }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    rcsConfig: {
      findUnique: async () => ({ account_sid: 'AC1', auth_token: 'enc', messaging_service_sid: 'MG1', from_number: null }),
    },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token', encrypt: (v: string) => v }))

import { sendRcsText } from './rcs'

describe('RCS/SMS over the Twilio SDK', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('never reaches Twilio in a test run', async () => {
    const out = await sendRcsText({ accountId: 'a', to: '+919847012345', text: 'hi' })
    expect(create).not.toHaveBeenCalled()
    expect(out.messageId).toMatch(/DEV_BLOCKED/)
  })

  it('never reaches Twilio on a staging server', async () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_ENV', 'staging')
    await sendRcsText({ accountId: 'a', to: '+919847012345', text: 'hi' })
    expect(create).not.toHaveBeenCalled()
  })

  it('production still sends', async () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('APP_ENV', '')
    vi.stubEnv('NODE_ENV', 'production')
    const out = await sendRcsText({ accountId: 'a', to: '+919847012345', text: 'hi' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(out.messageId).toBe('SMreal')
  })
})
