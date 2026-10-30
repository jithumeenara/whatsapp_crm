import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string } } }))
const profile = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
vi.mock('@/lib/db', () => {
  const anyModel = () => ({
    findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []),
    update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({ id: 'x' })),
    count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })),
  })
  const prisma = new Proxy({ profile } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : ((t[k] = anyModel()), t[k])),
  })
  return { prisma }
})
vi.mock('@/lib/whatsapp/resolve-config', () => ({ resolveWhatsAppConfig: vi.fn(async () => null) }))

import { PUT as putFlow } from '@/app/api/flows/[id]/route'
import { POST as createFlow } from '@/app/api/flows/route'
import { POST as publishFlow } from '@/app/api/flows/[id]/publish/route'
import { POST as activateFlow } from '@/app/api/flows/[id]/activate/route'
import { POST as newFlowKeys } from '@/app/api/flows/keys/route'
import { POST as createChatbot } from '@/app/api/chatbot/route'
import { PUT as putChatbot, PATCH as patchChatbot } from '@/app/api/chatbot/[id]/route'

const FLOW_ID = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id: FLOW_ID }) }
const json = (body: unknown) => new Request('https://x.test/', { method: 'POST', body: JSON.stringify(body) })

let n = 0
function signIn(role: string, page_access: unknown = null) {
  const id = `user-${role}-${++n}` // a fresh id dodges the profile cache
  session.current = { user: { id } }
  profile.findUnique.mockResolvedValue({
    user_id: id, account_id: 'acc-1', account_role: role, page_access, account: { id: 'acc-1', name: 'A' },
  })
}

const writes: Array<[string, () => Promise<Response>]> = [
  ['PUT /api/flows/[id]', () => putFlow(json({ name: 'x', nodes: [] }), params)],
  ['POST /api/flows', () => createFlow(json({ name: 'x' }))],
  ['POST /api/flows/[id]/publish', () => publishFlow(json({}), params)],
  ['POST /api/flows/[id]/activate', () => activateFlow(json({ status: 'active' }), params)],
  ['POST /api/flows/keys', () => newFlowKeys()],
  ['POST /api/chatbot', () => createChatbot(json({ name: 'x' }))],
  ['PUT /api/chatbot/[id]', () => putChatbot(json({ name: 'x' }), params)],
  ['PATCH /api/chatbot/[id]', () => patchChatbot(json({ status: 'active' }), params)],
]

// Security audit A9-06: these routes checked only "signed in", so a viewer
// could rewrite, publish or switch on any of the account's automations —
// and regenerate the Flows key pair, breaking every published Flow.
describe('flow and chatbot writes — role', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(writes)('%s refuses a viewer', async (_name, call) => {
    signIn('viewer', ['/flows', '/chatbot'])
    expect((await call()).status).toBe(403)
  })

  it.each(writes)('%s refuses an agent who was not given the page', async (_name, call) => {
    signIn('agent')
    expect((await call()).status).toBe(403)
  })

  it.each(writes)('%s lets an admin past the check', async (_name, call) => {
    signIn('admin')
    expect([401, 403]).not.toContain((await call()).status)
  })
})

describe('POST /api/flows/sync — role', () => {
  it('refuses a viewer', async () => {
    const { POST } = await import('@/app/api/flows/sync/route')
    signIn('viewer', ['/flows'])
    expect((await POST()).status).toBe(403)
  })
  it('lets an agent past the check (the chatbot editor imports Flows too)', async () => {
    const { POST } = await import('@/app/api/flows/sync/route')
    signIn('agent')
    expect([401, 403]).not.toContain((await POST()).status)
  })
})
