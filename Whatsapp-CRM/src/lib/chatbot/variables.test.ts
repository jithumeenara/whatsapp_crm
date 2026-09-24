import { describe, it, expect } from 'vitest'
import type { ChatbotBuilderNode } from './types'
import { allVariables, variablesByNode } from './variables'

const node = (node_key: string, node_type: ChatbotBuilderNode['node_type'], config: Record<string, unknown>): ChatbotBuilderNode =>
  ({ node_key, node_type, config, position_x: 0, position_y: 0 })

describe('variablesByNode', () => {
  const nodes = [
    node('start', 'start', { next_node_key: 'a' }),
    node('a', 'collect_input', { var_key: 'course', node_name: 'Ask course' }),
    node('b', 'set_variable', { assignments: [{ var_key: 'x' }, { var_key: '' }, { var_key: 'y' }] }),
    node('c', 'send_buttons', { save_reply_to: 'choice' }),
    node('d', 'ai_reply', { save_response_to: 'answer' }),
    node('e', 'http_request', { response_var: 'api' }),
    node('f', 'wait_flow_submit', { available_vars: ['from_date', 'to_date'] }),
    node('g', 'send_text', { text: 'hi' }),
  ]
  const groups = variablesByNode(nodes)

  it('groups each variable under the step that fills it, by the names the engine writes', () => {
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.vars.map((v) => v.key)]))
    expect(byId.a).toEqual(['course'])
    expect(byId.b).toEqual(['x', 'y'])
    expect(byId.c).toEqual(['choice'])
    expect(byId.d).toEqual(['answer'])
    expect(byId.e).toEqual(['api'])
    expect(byId.f).toEqual(['flow_from_date', 'flow_to_date'])
  })

  it('leaves out steps that fill nothing, and adds contact details last', () => {
    expect(groups.find((g) => g.id === 'g')).toBeUndefined()
    expect(groups.find((g) => g.id === 'start')).toBeUndefined()
    expect(groups.at(-1)?.id).toBe('__contact')
  })

  it("labels a step by the name it was given", () => {
    expect(groups.find((g) => g.id === 'a')?.label).toBe('Ask course')
  })

  it('gives the placeholder to paste', () => {
    expect(groups.find((g) => g.id === 'f')?.vars[0].token).toBe('{{vars.flow_from_date}}')
  })

  it('lists a Flow-triggered start step, but not a keyword one', () => {
    const flowStart = variablesByNode([node('s', 'start', { trigger_on: 'flow_submitted', available_vars: ['name'] })])
    expect(flowStart[0].vars[0].key).toBe('flow_name')
    const kwStart = variablesByNode([node('s', 'start', { trigger_keyword: 'hi', available_vars: ['name'] })])
    expect(kwStart.map((g) => g.id)).toEqual(['__contact'])
  })
})

describe('allVariables', () => {
  it('lists each placeholder once', () => {
    const groups = variablesByNode([
      node('a', 'collect_input', { var_key: 'name' }),
      node('b', 'collect_input', { var_key: 'name' }),
    ])
    const tokens = allVariables(groups).map((v) => v.token)
    expect(tokens.filter((t) => t === '{{vars.name}}')).toHaveLength(1)
  })
})
