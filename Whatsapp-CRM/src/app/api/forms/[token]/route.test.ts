import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reference a person gets after sending a public form: random (not a
 * slice of the row's id), the same on every row of a group, shown with the
 * business's own prefix, and the same again when an answer is sent twice.
 */

const BATCH = 'aaaaaaaa-1111-4111-8111-111111111111'
const TOKEN = 'x'.repeat(40)

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  savedCount: 0,
  savedFirst: null as null | { public_ref: string | null; created_at: Date },
  prefix: 'REG' as string | null,
  group: false,
  race: false,
}))

vi.mock('@/lib/data-store/schema', () => ({ ensureDataStoreColumns: () => Promise.resolve() }))
vi.mock('@/lib/data-store/record-events', () => ({ afterRecordCreated: () => {} }))
vi.mock('@/lib/data-store/form-confirm', () => ({ sendFormConfirmations: () => Promise.resolve() }))
vi.mock('@/lib/data-store/public-form-server', () => ({
  FORM_TOKEN: /^[A-Za-z0-9_-]{20,80}$/,
  checkRenderTicket: () => 'ok',
  verifyPersonalLink: () => null,
  validateFormValues: (_f: unknown, values: Record<string, unknown>) => ({ ok: true, values }),
  loadPublicForm: () =>
    Promise.resolve({
      tableId: 't1',
      accountId: 'acc',
      businessName: 'Any Business',
      responses: 0,
      lookups: {},
      fields: [
        { key: 'programme', label: 'Programme', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
      ],
      config: {
        enabled: true,
        success_message: null,
        closes_at: null,
        max_responses: null,
        one_per_person: false,
        consent_text: null,
        personal_only: false,
        rules: {},
        group: { enabled: h.group, label: 'Participant', person_keys: ['name'], min: 1, max: 10 },
        confirm_submitter: null,
        confirm_person: null,
        confirm_page: { enabled: true, title: null, summary_keys: [], person_keys: [], show_time: true, allow_print: true, ref_prefix: h.prefix },
      },
    }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    dataRecord: {
      count: () => Promise.resolve(h.savedCount),
      findFirst: () => Promise.resolve(h.savedFirst),
      create: (a: { data: Record<string, unknown> }) => {
        const row = { id: `bbbbbbbb-2222-4222-8222-22222222222${h.created.length}`, created_at: new Date('2026-10-29T10:00:00Z'), ...a.data }
        h.created.push(row)
        return Promise.resolve(row)
      },
    },
    $transaction: (ops: Array<Promise<unknown>>) => (h.race ? Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })) : Promise.all(ops)),
  },
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function send(body: Record<string, unknown>) {
  return POST(
    new Request(`http://x/api/forms/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.1' }, body: JSON.stringify({ ticket: 't', ...body }) }),
    { params: Promise.resolve({ token: TOKEN }) },
  )
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.created = []
  h.savedCount = 0
  h.savedFirst = null
  h.prefix = 'REG'
  h.group = false
  h.race = false
})

const REF = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

describe('the reference after sending a public form', () => {
  it('is random, stored on the row, shown with the business’s prefix, with the time it was saved', async () => {
    const res = await send({ values: { programme: 'Leadership', name: 'Anu' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.reference).toMatch(/^REG-/)
    const stored = h.created[0].public_ref as string
    expect(stored).toMatch(REF)
    expect(body.reference).toBe(`REG-${stored}`)
    // Not a slice of the row's own id any more.
    expect(body.reference).not.toContain('BBBBBBBB')
    expect(body.submitted_at).toBe('2026-10-29T10:00:00.000Z')
  })

  it('without a prefix, is the code alone', async () => {
    h.prefix = null
    const body = await (await send({ values: { programme: 'Leadership', name: 'Anu' } })).json()
    expect(body.reference).toMatch(REF)
  })

  it('is the same on every row of a group', async () => {
    h.group = true
    const res = await send({ values: { programme: 'Leadership' }, people: [{ name: 'Anu' }, { name: 'Ravi' }], batch: BATCH })
    expect(res.status).toBe(200)
    expect(h.created).toHaveLength(2)
    expect(h.created[0].public_ref).toBe(h.created[1].public_ref)
    expect(h.created.map((r) => r.batch_id)).toEqual([BATCH, BATCH])
  })

  it('a group sent again gets the reference it was saved with, not a new one', async () => {
    h.group = true
    h.savedCount = 2
    h.savedFirst = { public_ref: 'AAAA-BBBB-CCCC', created_at: new Date('2026-10-28T09:00:00Z') }
    const body = await (await send({ values: { programme: 'Leadership' }, people: [{ name: 'Anu' }, { name: 'Ravi' }], batch: BATCH })).json()
    expect(body).toMatchObject({ ok: true, reference: 'REG-AAAA-BBBB-CCCC', submitted_at: '2026-10-28T09:00:00.000Z', count: 2 })
    expect(h.created).toHaveLength(0)
  })

  it('a group saved before references existed keeps its old one', async () => {
    h.group = true
    h.savedCount = 1
    h.savedFirst = { public_ref: null, created_at: new Date('2026-10-01T09:00:00Z') }
    const body = await (await send({ values: { programme: 'Leadership' }, people: [{ name: 'Anu' }], batch: BATCH })).json()
    expect(body.reference).toBe('REG-AAAAAAAA')
  })
  it('two submissions never get the same reference', async () => {
    const a = await (await send({ values: { programme: 'Leadership', name: 'Anu' } })).json()
    const b = await (await send({ values: { programme: 'Leadership', name: 'Ravi' } })).json()
    expect(a.reference).not.toBe(b.reference)
  })

  it('the same group saved by another request at the same moment answers with that saved reference', async () => {
    h.group = true
    h.race = true
    h.savedFirst = { public_ref: 'DDDD-EEEE-FFFF', created_at: new Date('2026-10-29T08:00:00Z') }
    const body = await (await send({ values: { programme: 'Leadership' }, people: [{ name: 'Anu' }], batch: BATCH })).json()
    expect(body).toMatchObject({ ok: true, reference: 'REG-DDDD-EEEE-FFFF', submitted_at: '2026-10-29T08:00:00.000Z' })
  })

  it('a group sent again with different people is refused, and nothing is saved', async () => {
    h.group = true
    h.savedCount = 2
    h.savedFirst = { public_ref: 'AAAA-BBBB-CCCC', created_at: new Date() }
    const res = await send({ values: { programme: 'Leadership' }, people: [{ name: 'Anu' }], batch: BATCH })
    expect(res.status).toBe(409)
    expect(h.created).toHaveLength(0)
  })
})

