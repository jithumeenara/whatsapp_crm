import { beforeEach, describe, expect, it, vi } from 'vitest'

// Settings → AI → "Alert staff on Telegram": admins only, a boolean only,
// and the reach shown is counts — never names, numbers or Telegram ids.

const h = vi.hoisted(() => ({ role: 'admin', on: true, saved: [] as Array<[string, boolean]> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (h.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'me', role: 'admin' }
  },
  toErrorResponse: (e: { status?: number }) => new Response('{}', { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/ai/telegram-alert-setting', () => ({
  telegramAlertsOn: async () => h.on,
  setTelegramAlerts: async (acc: string, on: boolean) => { h.saved.push([acc, on]); h.on = on },
}))
vi.mock('@/lib/ai/staff-telegram', () => ({
  telegramAlertReach: async () => ({ admin_chat_on: true, bot_connected: true, recipients: 2, reachable_now: 1 }),
}))

import { GET, PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x/api/ai-config/telegram-alerts', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => { h.role = 'admin'; h.on = true; h.saved = [] })

describe('telegram alert switch', () => {
  it('shows the switch and counts only', async () => {
    const body = await (await GET()).json()
    expect(body).toEqual({ enabled: true, admin_chat_on: true, bot_connected: true, recipients: 2, reachable_now: 1 })
  })

  it('saves a boolean for the caller’s own account', async () => {
    const res = await put({ enabled: false })
    expect(res.status).toBe(200)
    expect(h.saved).toEqual([['acc', false]])
    expect((await res.json()).enabled).toBe(false)
  })

  it('refuses anything but true/false', async () => {
    expect((await put({ enabled: 'no' })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    expect(h.saved).toEqual([])
  })

  it('only admins may read or change it', async () => {
    h.role = 'agent'
    expect((await GET()).status).toBe(403)
    expect((await put({ enabled: false })).status).toBe(403)
  })
})
