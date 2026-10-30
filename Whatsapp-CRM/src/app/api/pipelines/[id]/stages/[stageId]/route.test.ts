import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A4-05: renaming a stage checked that the pipeline in the URL was the
 * caller's, then updated the stage by its id alone — so an admin of one
 * workspace could rename, recolour or reorder a stage in another
 * workspace's pipeline by pairing their own pipeline id with its id.
 */

const h = vi.hoisted(() => ({ writes: [] as unknown[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'admin' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    pipeline: { findFirst: () => Promise.resolve({ id: 'p-mine', account_id: 'acc' }) },
    pipelineStage: {
      // The other workspace's stage exists; it is just not in p-mine.
      update: (a: unknown) => { h.writes.push(a); return Promise.resolve({ id: 's-theirs' }) },
      updateMany: (a: { where: { id: string; pipeline_id: string } }) => {
        h.writes.push(a)
        return Promise.resolve({ count: a.where.pipeline_id === 'p-mine' && a.where.id === 's-mine' ? 1 : 0 })
      },
      findFirst: (a: { where: { id: string; pipeline_id: string } }) =>
        Promise.resolve(a.where.id === 's-mine' && a.where.pipeline_id === 'p-mine' ? { id: 's-mine', name: 'New name' } : null),
    },
  },
}))

import { PATCH } from './route'

const patch = (stageId: string) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'pwned' }) }) as never, {
    params: Promise.resolve({ id: 'p-mine', stageId }),
  })

describe('PATCH a pipeline stage', () => {
  beforeEach(() => {
    h.writes = []
  })

  it('cannot touch a stage of another workspace’s pipeline', async () => {
    const res = await patch('s-theirs')
    expect(res.status).toBe(404)
    for (const w of h.writes) expect(w).toMatchObject({ where: { pipeline_id: 'p-mine' } })
  })

  it('still renames a stage of the caller’s own pipeline', async () => {
    const res = await patch('s-mine')
    expect(res.status).toBe(200)
  })
})
