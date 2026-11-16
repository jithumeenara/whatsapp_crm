import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: merging a WhatsApp contact with the same person's Instagram or
 * Messenger contact copied instagram_id / facebook_id to the survivor while
 * the merged record still held it. Both columns are unique per account, so
 * the transaction failed and the merge could never be done. (Telegram's id
 * was already moved the safe way: cleared on the merged record first.)
 */

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}))

function contactUpdate({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
  // The database's unique indexes on (account_id, instagram_id / facebook_id).
  for (const col of ['instagram_id', 'facebook_id', 'telegram_id']) {
    const v = data[col]
    if (v == null) continue
    const clash = Object.values(h.rows).find((r) => r.id !== where.id && r[col] === v)
    if (clash) throw Object.assign(new Error(`Unique constraint failed on ${col}`), { code: 'P2002' })
  }
  h.updates.push({ id: where.id, data })
  Object.assign(h.rows[where.id], data)
  return h.rows[where.id]
}

const anyModel = new Proxy({}, {
  get: () => ({
    updateMany: async () => ({ count: 0 }),
    findMany: async () => [],
    findFirst: async () => null,
    deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }),
    create: async () => ({ id: 'x' }),
    update: async () => ({}),
    count: async () => 0,
    upsert: async () => ({}),
  }),
})

vi.mock('@/lib/db', () => {
  const tx = new Proxy({}, {
    get: (_t, model: string) => {
      if (model === 'contact') return { update: contactUpdate }
      if (model.startsWith('$')) return async () => []
      return (anyModel as Record<string, unknown>)[model]
    },
  })
  return {
    prisma: {
      contact: {
        findFirst: async ({ where }: { where: { id: string } }) => h.rows[where.id] ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => h.rows[where.id] ?? null,
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))

import { mergeContacts } from './merge'

beforeEach(() => {
  h.updates = []
  h.rows = {
    wa: { id: 'wa', account_id: 'acc', name: 'Meera', phone: '+919847012345', instagram_id: null, facebook_id: null, telegram_id: null, merged_into_contact_id: null },
    ig: { id: 'ig', account_id: 'acc', name: 'meera.k', phone: '998877', instagram_id: '998877', facebook_id: '7654321', telegram_id: null, merged_into_contact_id: null },
  }
})

describe('merging with an Instagram / Messenger contact', () => {
  it('succeeds, and the Instagram and Messenger ids end up on the kept contact', async () => {
    await expect(mergeContacts({ accountId: 'acc', userId: 'u', survivorId: 'wa', mergedId: 'ig' })).resolves.toBeTruthy()
    expect(h.rows.wa).toMatchObject({ instagram_id: '998877', facebook_id: '7654321' })
    expect(h.rows.ig).toMatchObject({ instagram_id: null, facebook_id: null, merged_into_contact_id: 'wa' })
  })
})
