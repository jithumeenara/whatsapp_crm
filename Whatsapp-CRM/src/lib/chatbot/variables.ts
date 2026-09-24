/**
 * Every variable a chatbot can use, grouped by the step that fills it.
 *
 * The builder shows this in every step: pick a step, then one of its
 * variables, and copy the placeholder. The names here must be the ones
 * the engine actually writes (src/lib/flows/engine.ts), or a placeholder
 * copied from the list would print nothing:
 *
 *  - collect_input                → var_key
 *  - set_variable                 → each assignment's var_key
 *  - send_buttons / send_list     → save_reply_to (the tapped option)
 *  - ai_reply                     → save_response_to
 *  - http_request                 → response_var
 *  - send_flow, wait_flow_submit,
 *    start (on Flow submitted)    → flow_<field> for each Flow field
 *
 * Contact details are always available, in their own group.
 */

import type { ChatbotBuilderNode } from './types'
import { nodeDisplayName } from './node-meta'

export interface VariableOption {
  /** The variable's name, e.g. "course" or "flow_from_date". */
  key: string
  /** What to paste into a message, e.g. "{{vars.course}}". */
  token: string
}

export interface VariableGroup {
  /** Node key, or "__contact" for the contact group. */
  id: string
  label: string
  vars: VariableOption[]
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function keysFor(node: ChatbotBuilderNode): string[] {
  const c = node.config ?? {}
  switch (node.node_type) {
    case 'collect_input':
      return [str(c.var_key)]
    case 'set_variable':
      return Array.isArray(c.assignments)
        ? (c.assignments as Array<Record<string, unknown>>).map((a) => str(a.var_key))
        : []
    case 'send_buttons':
    case 'send_list':
      return [str(c.save_reply_to)]
    case 'ai_reply':
      return [str(c.save_response_to)]
    case 'http_request':
      return [str(c.response_var)]
    case 'send_flow':
    case 'wait_flow_submit':
      return flowKeys(c.available_vars)
    case 'start':
      return c.trigger_on === 'flow_submitted' ? flowKeys(c.available_vars) : []
    default:
      return []
  }
}

function flowKeys(tokens: unknown): string[] {
  return Array.isArray(tokens)
    ? tokens.filter((t): t is string => typeof t === 'string' && t !== '').map((t) => `flow_${t}`)
    : []
}

export const CONTACT_VARIABLES: VariableOption[] = [
  { key: 'contact.name', token: '{{contact.name}}' },
  { key: 'contact.phone', token: '{{contact.phone}}' },
  { key: 'contact.email', token: '{{contact.email}}' },
  { key: 'contact.company', token: '{{contact.company}}' },
]

/** Steps that fill variables, in canvas order, each with its variables;
 *  then the contact group. Steps that fill nothing are left out, and a
 *  name used twice is listed under each step that sets it. */
export function variablesByNode(nodes: ChatbotBuilderNode[]): VariableGroup[] {
  const groups: VariableGroup[] = []
  for (const node of nodes) {
    const seen = new Set<string>()
    const vars: VariableOption[] = []
    for (const key of keysFor(node)) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      vars.push({ key, token: `{{vars.${key}}}` })
    }
    if (vars.length > 0) {
      groups.push({ id: node.node_key, label: nodeDisplayName(node), vars })
    }
  }
  groups.push({ id: '__contact', label: 'Contact details', vars: CONTACT_VARIABLES })
  return groups
}

/** Every variable once, for the "all variables" list. */
export function allVariables(groups: VariableGroup[]): VariableOption[] {
  const seen = new Set<string>()
  const out: VariableOption[] = []
  for (const g of groups) {
    for (const v of g.vars) {
      if (seen.has(v.token)) continue
      seen.add(v.token)
      out.push(v)
    }
  }
  return out
}
