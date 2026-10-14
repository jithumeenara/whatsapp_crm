import { beforeEach, describe, expect, it, vi } from 'vitest'

// Bug: an agent's dashboard counted and listed the whole account — every
// open chat, every customer's message in Recent Activity ("New message
// from JITHU L R" for chats assigned to somebody else), every new
// contact, every hot lead. The Inbox shows an agent only the chats
// assigned to them; the dashboard must show the same work and no more.

const h = vi.hoisted(() => ({ calls: [] as Array<{ model: string; method: string; where: unknown }> }))

vi.mock('@/lib/db', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args?: { where?: unknown }) => {
          h.calls.push({ model: name, method, where: args?.where })
          return Promise.resolve(method === 'count' ? 0 : [])
        },
      },
    )
  return {
    prisma: new Proxy({}, { get: (_t, name: string) => model(name) }),
  }
})

import {
  loadActivity,
  loadConversationsSeries,
  loadCRMStats,
  loadMetrics,
  loadResponseTime,
  loadSparks,
} from './queries'

const ACCOUNT = 'acc-1'
const AGENT = 'agent-1'

async function loadEverything(agentId: string | null) {
  await loadMetrics(ACCOUNT, agentId)
  await loadConversationsSeries(ACCOUNT, 7, agentId)
  await loadResponseTime(ACCOUNT, agentId)
  await loadActivity(ACCOUNT, 8, false, agentId)
  await loadCRMStats(ACCOUNT, agentId)
  await loadSparks(ACCOUNT, 7, agentId)
}

/** Customer-facing work: these must be narrowed to the agent's own. */
const WORK = ['conversation', 'message', 'contact', 'lead', 'followUp', 'task']

beforeEach(() => {
  h.calls.length = 0
})

describe("an agent's dashboard shows only the agent's own work", () => {
  it('limits every chat, message, contact, lead, follow-up and task query to that agent', async () => {
    await loadEverything(AGENT)
    const work = h.calls.filter((c) => WORK.includes(c.model))
    expect(work.length).toBeGreaterThan(0)
    const unscoped = work.filter((c) => !JSON.stringify(c.where ?? {}).includes(AGENT))
    expect(unscoped.map((c) => `${c.model}.${c.method}`)).toEqual([])
  })

  it('does not list account-wide broadcasts or automation runs to an agent', async () => {
    await loadEverything(AGENT)
    const accountWide = h.calls.filter((c) => c.model === 'broadcast' || c.model === 'automationLog')
    expect(accountWide).toEqual([])
  })

  it('still shows the whole account to somebody who manages the team', async () => {
    await loadEverything(null)
    expect(h.calls.some((c) => JSON.stringify(c.where ?? {}).includes(AGENT))).toBe(false)
    expect(h.calls.some((c) => c.model === 'broadcast')).toBe(true)
  })
})
