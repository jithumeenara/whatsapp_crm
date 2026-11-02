import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A config change is recorded as WHICH fields changed — never their
 * values (plan §5 P1 config). The values here are messages and phone
 * numbers; elsewhere they are tokens and prompts.
 */

const h = vi.hoisted(() => ({ written: [] as Array<{ ctx: unknown; entry: unknown }> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: '11111111-1111-4111-8111-111111111111', role: 'admin' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/audit/write', async () => {
  const real = await vi.importActual<typeof import('@/lib/audit/write')>('@/lib/audit/write')
  return {
    ...real,
    audit: (ctx: unknown, entry: unknown) => {
      h.written.push({ ctx, entry })
      return Promise.resolve()
    },
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    contactCaptureConfig: {
      findUnique: () =>
        Promise.resolve({
          enabled: false,
          confirm_message: 'OLD-CONFIRM-TEXT',
          ask_name_message: 'same',
          new_contact_alert_enabled: false,
          new_contact_alert_numbers: ['919800000001'],
          new_contact_alert_template: null,
        }),
      upsert: ({ update }: { update: Record<string, unknown> }) => Promise.resolve({ ...update }),
    },
  },
}))

import { PATCH } from './route'
import { prepare } from '@/lib/audit/write'

describe('capture-config changes are audited by field name only', () => {
  beforeEach(() => {
    h.written = []
  })

  it('stores the changed field names, never the messages or numbers', async () => {
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: true,
          confirm_message: 'NEW-CONFIRM-TEXT',
          ask_name_message: 'same',
          new_contact_alert_numbers: ['919811112222'],
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(h.written).toHaveLength(1)
    const { ctx, entry } = h.written[0] as { ctx: never; entry: { action: string; meta: { fields: string[] } } }
    expect(entry.action).toBe('config.security_changed')
    expect(entry.meta.fields).toEqual(['confirm_message', 'enabled', 'new_contact_alert_numbers'])

    // What would actually be stored.
    const row = prepare(ctx, entry as never)
    const stored = JSON.stringify(row)
    expect(stored).not.toMatch(/CONFIRM-TEXT|9198|1112222|0000001/)
    expect(row.changes).toBeNull()
  })
})
