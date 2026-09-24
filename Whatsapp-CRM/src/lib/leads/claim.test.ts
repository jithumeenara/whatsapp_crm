import { describe, it, expect, vi, beforeEach } from 'vitest'

const lead = vi.hoisted(() => ({ updateMany: vi.fn(), findFirst: vi.fn() }))
const conversation = vi.hoisted(() => ({ updateMany: vi.fn() }))
const followUp = vi.hoisted(() => ({ updateMany: vi.fn() }))
const leadActivity = vi.hoisted(() => ({ create: vi.fn() }))
const emitToAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { lead, conversation, followUp, leadActivity } }))
vi.mock('@/lib/socket', () => ({ emitToAccount }))

import { claimIfUnassigned } from './claim'

const args = { accountId: 'acc', leadId: 'lead-1', userId: 'agent-1', how: 'by marking a follow-up done' }

beforeEach(() => {
  vi.clearAllMocks()
  lead.findFirst.mockResolvedValue({ id: 'lead-1', title: 'Anu', status: 'follow_up', contact_id: 'c-1' })
  conversation.updateMany.mockResolvedValue({ count: 1 })
  followUp.updateMany.mockResolvedValue({ count: 1 })
  leadActivity.create.mockResolvedValue({})
})

describe('claimIfUnassigned', () => {
  it('takes only a lead nobody holds, in this account', async () => {
    lead.updateMany.mockResolvedValue({ count: 1 })
    expect(await claimIfUnassigned(args)).toBe(true)
    expect(lead.updateMany.mock.calls[0][0].where).toEqual({ id: 'lead-1', account_id: 'acc', assigned_to: null })
    expect(lead.updateMany.mock.calls[0][0].data.assigned_to).toBe('agent-1')
  })

  it('brings the conversation and the call-backs with it, and says so', async () => {
    lead.updateMany.mockResolvedValue({ count: 1 })
    await claimIfUnassigned(args)
    expect(conversation.updateMany.mock.calls[0][0].where.assigned_agent_id).toBeNull()
    expect(followUp.updateMany.mock.calls[0][0].data.assigned_to).toBe('agent-1')
    expect(leadActivity.create.mock.calls[0][0].data.description).toContain('marking a follow-up done')
    expect(emitToAccount).toHaveBeenCalledWith('acc', 'lead', expect.objectContaining({ eventType: 'UPDATE' }))
  })

  it('changes nothing when someone already holds it', async () => {
    lead.updateMany.mockResolvedValue({ count: 0 })
    expect(await claimIfUnassigned(args)).toBe(false)
    expect(conversation.updateMany).not.toHaveBeenCalled()
    expect(followUp.updateMany).not.toHaveBeenCalled()
    expect(leadActivity.create).not.toHaveBeenCalled()
  })
})
