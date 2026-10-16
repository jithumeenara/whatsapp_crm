import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The WhatsApp numbers a website shows are the account's own connected
 * numbers — never another account's, and never with a token attached.
 */

const OURS = '11111111-1111-4111-8111-111111111111'
const THEIRS = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({ metaFails: false, whereSeen: [] as unknown[] }))

vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: {
      findMany: (a: { where: { account_id: string; id?: { in: string[] } } }) => {
        h.whereSeen.push(a.where)
        const rows = [
          { id: OURS, account_id: 'acc', label: 'Admissions', is_default: true, phone_number_id: 'pn1', access_token: 'enc-token', status: 'connected' },
          { id: THEIRS, account_id: 'other', label: 'Not yours', is_default: true, phone_number_id: 'pn2', access_token: 'enc-2', status: 'connected' },
        ]
        return Promise.resolve(
          rows.filter((r) => r.account_id === a.where.account_id && (!a.where.id || a.where.id.in.includes(r.id))),
        )
      },
    },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain-${v}` }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: () =>
    h.metaFails ? Promise.reject(new Error('Meta down')) : Promise.resolve({ display_phone_number: '+91 85900 55117' }),
}))

import { accountWhatsAppNumbers, snapshotWhatsAppLinks } from './whatsapp-snapshot'

describe('WhatsApp numbers for the contact menu', () => {
  beforeEach(() => {
    h.metaFails = false
    h.whereSeen = []
  })

  it('lists only this account\'s numbers, with the phone and no token', async () => {
    const list = await accountWhatsAppNumbers('acc')
    expect(list).toEqual([{ id: OURS, label: 'Admissions', is_default: true, status: 'connected', phone: '918590055117' }])
    expect(JSON.stringify(list)).not.toContain('token')
  })

  it('snapshots a chosen number with its phone from Meta', async () => {
    expect(await snapshotWhatsAppLinks('acc', [{ config_id: OURS, label: 'Admissions' }])).toEqual({
      ok: true,
      links: [{ config_id: OURS, label: 'Admissions', phone: '918590055117' }],
    })
  })

  it('refuses another account\'s number', async () => {
    const r = await snapshotWhatsAppLinks('acc', [{ config_id: THEIRS, label: 'x' }])
    expect(r.ok).toBe(false)
  })

  it('says so when Meta cannot be reached, instead of saving a blank', async () => {
    h.metaFails = true
    const r = await snapshotWhatsAppLinks('acc', [{ config_id: OURS, label: 'Admissions' }])
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toContain('Admissions')
  })
})
