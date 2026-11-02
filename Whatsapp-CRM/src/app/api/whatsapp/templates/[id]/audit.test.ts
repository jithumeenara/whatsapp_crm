import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Audit log (plan §4/§5): editing a WhatsApp template records
 * record.updated with the changed fields, and the message body is kept
 * only as its length — never the text a business sends its customers.
 */

const h = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit')
  const { prepare } = await vi.importActual<typeof import('@/lib/audit/write')>('@/lib/audit/write')
  return {
    ...actual,
    audit: async (ctx: Parameters<typeof prepare>[0], e: Parameters<typeof prepare>[1] | Parameters<typeof prepare>[1][]) => {
      for (const x of Array.isArray(e) ? e : [e]) h.events.push(prepare(ctx, x) as unknown as Record<string, unknown>)
    },
  }
})
vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: '11111111-1111-4111-8111-111111111111', userId: 'u1', role: 'supervisor' }) }
})
vi.mock('@/lib/whatsapp/meta-api', () => ({ editMessageTemplate: vi.fn(), deleteMessageTemplate: vi.fn() }))
vi.mock('@/lib/whatsapp/template-validators', () => ({ validateTemplatePayload: () => {} }))
vi.mock('@/lib/whatsapp/template-components', () => ({ buildMetaTemplatePayload: () => ({ components: [] }) }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({ resolveWhatsAppConfig: vi.fn() }))

const OLD_BODY = 'Hello {{1}}, your seat for the October batch is confirmed.'
const NEW_BODY = 'Hi {{1}}! Your seat for the November batch is confirmed. Reply YES to keep it.'

vi.mock('@/lib/db', () => ({
  prisma: {
    messageTemplate: {
      findFirst: async () => ({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'seat_confirmed', status: 'APPROVED', meta_template_id: 'm1',
        language: 'en', waba_id: null, category: 'Utility', header_type: null, header_content: null,
        header_media_url: null, body_text: OLD_BODY, footer_text: null, buttons: null,
      }),
      update: async (a: { data: Record<string, unknown> }) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...a.data }),
    },
  },
}))

import { PATCH } from './route'

describe('template edit — audit', () => {
  beforeEach(() => {
    h.events = []
    process.env.WHATSAPP_TEMPLATES_DRY_RUN = 'true'
  })

  it('records record.updated with the body stored as its length only', async () => {
    const res = await PATCH(
      new Request('https://x.test/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'seat_confirmed', category: 'Utility', language: 'en', body_text: NEW_BODY }),
      }),
      { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) },
    )
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const e = h.events[0]
    expect(e.action).toBe('record.updated')
    expect(e.target_type).toBe('template')
    expect(e.target_label).toBe('seat_confirmed')
    const changes = e.changes as Record<string, [unknown, unknown]>
    expect(changes.body_text).toEqual([`(${OLD_BODY.length} chars)`, `(${NEW_BODY.length} chars)`])
    expect(changes.status).toEqual(['APPROVED', 'PENDING'])
    const stored = JSON.stringify(e)
    expect(stored).not.toContain('November batch')
    expect(stored).not.toContain('October batch')
  })
})
