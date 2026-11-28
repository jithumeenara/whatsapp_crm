import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: Sheet routing said "Google Sheets is switched off" when the real
 * cause was an expired Google sign-in, so the admin looked for a setting
 * nobody had changed. The message now names the actual reason.
 */

const h = vi.hoisted(() => ({ conn: null as null | Record<string, unknown> }))
vi.mock('@/lib/db', () => ({
  prisma: {
    googleConnection: { findUnique: async () => h.conn },
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async () => [],
  },
}))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: async () => {} }))

import { googleServiceProblem } from './oauth'
import { serviceById } from './services'

const scopes = (id: string) => serviceById(id)?.scopes ?? []
const base = { id: 'g1', refresh_token: 'enc', status: 'connected', enabled_services: ['sheets'], granted_scopes: scopes('sheets') }

beforeEach(() => { h.conn = { ...base } })

describe('googleServiceProblem', () => {
  it('nothing wrong: null', async () => {
    expect(await googleServiceProblem('acc', ['sheets_sync', 'sheets'])).toBeNull()
  })
  it('an expired or refused sign-in says so, not "switched off"', async () => {
    h.conn = { ...base, status: 'error' }
    const msg = await googleServiceProblem('acc', ['sheets_sync', 'sheets'])
    expect(msg).toMatch(/sign-in has expired or was refused/)
    expect(msg).not.toMatch(/switched off/)
  })
  it('not connected at all', async () => {
    h.conn = null
    expect(await googleServiceProblem('acc', ['sheets'])).toMatch(/not connected/)
  })
  it('really switched off', async () => {
    h.conn = { ...base, enabled_services: [] }
    expect(await googleServiceProblem('acc', ['sheets_sync', 'sheets'])).toMatch(/switched off/)
  })
  it('switched on but the permission was not granted', async () => {
    h.conn = { ...base, granted_scopes: [] }
    expect(await googleServiceProblem('acc', ['sheets'])).toMatch(/did not grant/)
  })
})
