import { describe, it, expect, vi, beforeEach } from 'vitest'

const message = vi.hoisted(() => ({ findFirst: vi.fn() }))
const messageTemplate = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { message, messageTemplate } }))

import { flowVarsFromResponse, identifySubmittedFlow, pickFlowSubmittedChatbot } from './flow-submitted-trigger'

const bot = (id: string, trigger_type: string, trigger_config: unknown) => ({ id, trigger_type, trigger_config })

describe('pickFlowSubmittedChatbot', () => {
  const any = bot('any', 'manual', { start_on: 'flow_submitted', meta_flow_id: null })
  const specific = bot('specific', 'manual', { start_on: 'flow_submitted', meta_flow_id: '111' })
  const other = bot('other', 'manual', { start_on: 'flow_submitted', meta_flow_id: '222' })

  it('prefers the chatbot tied to this Flow over an any-Flow one', () => {
    expect(pickFlowSubmittedChatbot([any, specific], '111')?.id).toBe('specific')
  })
  it('falls back to any-Flow when none is tied to this Flow', () => {
    expect(pickFlowSubmittedChatbot([other, any], '111')?.id).toBe('any')
  })
  it('only any-Flow matches when the Flow cannot be told', () => {
    expect(pickFlowSubmittedChatbot([specific, other], null)).toBeNull()
    expect(pickFlowSubmittedChatbot([specific, any], null)?.id).toBe('any')
  })
  it('ignores ordinary chatbots', () => {
    const always = bot('always', 'always', {})
    const plainManual = bot('manual', 'manual', {})
    const keyword = bot('kw', 'keyword', { start_on: 'flow_submitted' })
    expect(pickFlowSubmittedChatbot([always, plainManual, keyword], '111')).toBeNull()
  })
})

describe('flowVarsFromResponse', () => {
  it('prefixes each field with flow_', () => {
    expect(flowVarsFromResponse({ name: 'Anu', course: 'PSC' })).toEqual({ flow_name: 'Anu', flow_course: 'PSC' })
  })
  it('drops field names that are not plain names', () => {
    expect(flowVarsFromResponse({ 'a.b': 1, '__proto__': 2, ok_1: 3 })).toEqual({ flow_ok_1: 3 })
  })
})

describe('identifySubmittedFlow', () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads the Flow id off the template's FLOW button", async () => {
    message.findFirst.mockResolvedValue({ template_name: 'admission_form' })
    messageTemplate.findMany.mockResolvedValue([
      { buttons: [{ type: 'QUICK_REPLY', text: 'No' }, { type: 'FLOW', text: 'Apply', flow_id: '98765' }] },
    ])
    expect(await identifySubmittedFlow('acc', 'msg')).toBe('98765')
    // Scoped to the account — another account's message is not found.
    expect(message.findFirst.mock.calls[0][0].where.conversation).toEqual({ account_id: 'acc' })
  })

  it('is null without a source message, a template, or a FLOW button', async () => {
    expect(await identifySubmittedFlow('acc', null)).toBeNull()
    message.findFirst.mockResolvedValue({ template_name: null })
    expect(await identifySubmittedFlow('acc', 'msg')).toBeNull()
    message.findFirst.mockResolvedValue({ template_name: 't' })
    messageTemplate.findMany.mockResolvedValue([{ buttons: [{ type: 'URL', text: 'Site' }] }])
    expect(await identifySubmittedFlow('acc', 'msg')).toBeNull()
  })
})
