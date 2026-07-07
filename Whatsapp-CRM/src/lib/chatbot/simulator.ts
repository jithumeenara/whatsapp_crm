/**
 * Client-side chatbot playground simulator.
 *
 * Walks the chatbot node graph without any server calls.
 * AI replies produce plausible stub text; HTTP requests return
 * a mock payload. The simulator is purely for builder UX testing.
 */

import type { ChatbotBuilderNode } from './types'

// ─── Message types rendered in the playground ───────────────────

export type PlaygroundMsgRole = 'bot' | 'user' | 'system'

export interface PlaygroundMsg {
  id: string
  role: PlaygroundMsgRole
  /** Plain text or react-rendered content */
  text: string
  /** Rendered as tappable chips below the message */
  buttons?: Array<{ id: string; label: string; nextKey: string }>
  /** Rendered as a scrollable list picker */
  listOptions?: Array<{ id: string; label: string; description?: string; nextKey: string }>
  /** If set, the selected button/list option's title is saved to this variable key */
  saveVarKey?: string
  /** 'input' waits for the user to type a free-text reply */
  awaitInput?: { varKey: string; nextKey: string; inputType: string; errorMessage?: string }
  /** Shows a media preview */
  media?: { type: string; url: string; caption?: string; filename?: string }
  /** Is this the last message? */
  terminal?: boolean
}

export interface PlaygroundState {
  msgs: PlaygroundMsg[]
  vars: Record<string, string>
  /** Current node key being executed (null = done) */
  currentKey: string | null
  /** True while a delay or async step is running */
  waiting: boolean
  done: boolean
}

let _msgId = 0
function uid() { return `pm_${++_msgId}` }

/**
 * Interpolate template variables in order of specificity:
 *   {{vars.name}}    → explicit vars namespace
 *   {{contact.x}}   → contact fields
 *   {{name}}         → shorthand for {{vars.name}} (no dot = collected var)
 */
function interp(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{vars\.([^}]+)\}\}/g, (_, k) => vars[k] ?? `{{vars.${k}}}`)
    .replace(/\{\{contact\.([^}]+)\}\}/g, (_, k) => vars[`contact.${k}`] ?? `{{contact.${k}}}`)
    // Short forms: {{name}} → contact.name, {{phone}}/{{number}} → contact.phone
    .replace(/\{\{name\}\}/gi, vars['contact.name'] ?? '{{name}}')
    .replace(/\{\{phone\}\}/gi, vars['contact.phone'] ?? '{{phone}}')
    .replace(/\{\{number\}\}/gi, vars['contact.phone'] ?? '{{number}}')
    // Generic short form {{key}} → vars[key] if available
    .replace(/\{\{([^}.]+)\}\}/g, (match, k) => vars[k] ?? match)
}

/** Evaluate a single condition clause. */
function evalCondition(
  subject: string,
  subjectKey: string,
  operator: string,
  value: string | undefined,
  vars: Record<string, string>,
  caseSensitive = true,
): boolean {
  let raw = ''
  if (subject === 'var') raw = vars[subjectKey] ?? ''
  else if (subject === 'contact_field') raw = vars[`contact.${subjectKey}`] ?? ''
  else if (subject === 'tag') raw = vars[`tag.${subjectKey}`] ?? ''

  const actual  = caseSensitive ? raw        : raw.toLowerCase()
  const compare = caseSensitive ? (value ?? '') : (value ?? '').toLowerCase()

  switch (operator) {
    case 'equals':      return actual === compare
    case 'not_equals':  return actual !== compare
    case 'contains':    return actual.includes(compare)
    case 'starts_with': return actual.startsWith(compare)
    case 'ends_with':   return actual.endsWith(compare)
    case 'present':     return actual.length > 0
    case 'absent':      return actual.length === 0
    case 'gt':          return Number(raw) > Number(value)
    case 'lt':          return Number(raw) < Number(value)
    case 'gte':         return Number(raw) >= Number(value)
    case 'lte':         return Number(raw) <= Number(value)
    default:            return false
  }
}

const AI_STUBS = [
  "Thank you for reaching out! I'd be happy to help you with that. Could you please provide a bit more detail about your request?",
  "Great question! Based on what you've shared, I can offer the following: we have several options available for you. Our team will be in touch shortly to discuss the best fit for your needs.",
  "I understand your concern. Let me assure you that we take all customer feedback very seriously. I'm processing your request and will get back to you with a solution momentarily.",
  "Hello! Thanks for contacting us. I've reviewed your inquiry and I'm glad to help. Your request has been noted and our team is already on it.",
]

/**
 * Execute the NEXT step of the flow from `startKey`, appending to
 * `prevState`. Returns a new state snapshot.
 *
 * Auto-advances through non-interactive nodes (text, media, delay,
 * set_variable, etc.) in one synchronous pass, stopping only when:
 *   - An interactive node needs user input (buttons, list, collect_input)
 *   - A terminal node is reached (end, handoff, link_chatbot)
 */
export function runUntilInteractive(
  nodes: ChatbotBuilderNode[],
  startKey: string | null,
  prevState: PlaygroundState,
): PlaygroundState {
  if (!startKey) {
    return { ...prevState, done: true, currentKey: null }
  }

  const nodeMap = new Map(nodes.map((n) => [n.node_key, n]))
  const state: PlaygroundState = {
    msgs: [...prevState.msgs],
    vars: { ...prevState.vars },
    currentKey: startKey,
    waiting: false,
    done: false,
  }

  let key: string | null = startKey
  let steps = 0
  const MAX_STEPS = 50 // guard against infinite loops in bad configs

  while (key && steps++ < MAX_STEPS) {
    const node = nodeMap.get(key)
    if (!node) {
      state.msgs.push({
        id: uid(),
        role: 'system',
        text: `⚠ Node "${key}" not found in chatbot.`,
        terminal: true,
      })
      state.done = true
      state.currentKey = null
      break
    }

    const cfg = node.config
    const next = (k: unknown) => (typeof k === 'string' && k.length > 0 ? k : null)

    switch (node.node_type) {
      case 'start': {
        key = next(cfg.next_node_key)
        break
      }

      case 'send_text': {
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: interp(typeof cfg.text === 'string' ? cfg.text : '(empty message)', state.vars),
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'send_media': {
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: interp(typeof cfg.caption === 'string' ? cfg.caption : '', state.vars),
          media: {
            type: typeof cfg.media_type === 'string' ? cfg.media_type : 'image',
            url: typeof cfg.media_url === 'string' ? cfg.media_url : '',
            caption: typeof cfg.caption === 'string' ? cfg.caption : undefined,
            filename: typeof cfg.filename === 'string' ? cfg.filename : undefined,
          },
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'send_buttons': {
        const buttons = Array.isArray(cfg.buttons)
          ? (cfg.buttons as Array<Record<string, unknown>>).map((b) => ({
              id: String(b.reply_id ?? uid()),
              label: String(b.title ?? 'Option'),
              nextKey: String(b.next_node_key ?? ''),
            }))
          : []
        const btnSaveVar = typeof cfg.save_reply_to === 'string' && cfg.save_reply_to.trim()
          ? cfg.save_reply_to.trim()
          : undefined
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: interp(typeof cfg.text === 'string' ? cfg.text : 'Choose an option:', state.vars),
          buttons,
          saveVarKey: btnSaveVar,
        })
        // Stop — wait for user button click
        state.currentKey = null
        return state
      }

      case 'send_list': {
        const sections = Array.isArray(cfg.sections)
          ? (cfg.sections as Array<Record<string, unknown>>)
          : []
        const listOptions: PlaygroundMsg['listOptions'] = []
        for (const section of sections) {
          const rows = Array.isArray(section.rows) ? (section.rows as Array<Record<string, unknown>>) : []
          for (const row of rows) {
            listOptions.push({
              id: String(row.reply_id ?? uid()),
              label: String(row.title ?? 'Option'),
              description: typeof row.description === 'string' ? row.description : undefined,
              nextKey: String(row.next_node_key ?? ''),
            })
          }
        }
        const listSaveVar = typeof cfg.save_reply_to === 'string' && cfg.save_reply_to.trim()
          ? cfg.save_reply_to.trim()
          : undefined
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: interp(typeof cfg.text === 'string' ? cfg.text : 'Select an option:', state.vars),
          listOptions,
          saveVarKey: listSaveVar,
        })
        state.currentKey = null
        return state
      }

      case 'collect_input': {
        const inputType = typeof cfg.input_type === 'string' ? cfg.input_type : 'text'
        const promptSuffix: Record<string, string> = {
          email: ' (send your email address)',
          phone: ' (send your phone number)',
          number: ' (send a number)',
          website: ' (send a URL)',
          date: ' (send a date)',
          time: ' (send a time)',
          file: ' (send a file)',
          location: ' (share your location)',
        }
        const prompt = interp(
          typeof cfg.prompt_text === 'string' ? cfg.prompt_text : 'Please type your answer:',
          state.vars,
        ) + (promptSuffix[inputType] ?? '')

        const validation = cfg.validation as Record<string, unknown> | undefined
        const customErrorMsg = typeof validation?.error_message === 'string' && validation.error_message.trim()
          ? validation.error_message.trim()
          : undefined

        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: prompt,
          awaitInput: {
            varKey: typeof cfg.var_key === 'string' ? cfg.var_key : 'input',
            nextKey: String(cfg.next_node_key ?? ''),
            inputType,
            errorMessage: customErrorMsg,
          },
        })
        state.currentKey = null
        return state
      }

      case 'condition': {
        const subject = typeof cfg.subject === 'string' ? cfg.subject : 'var'
        const subjectKey = typeof cfg.subject_key === 'string' ? cfg.subject_key : ''
        const operator = typeof cfg.operator === 'string' ? cfg.operator : 'equals'
        const value = typeof cfg.value === 'string' ? cfg.value : undefined
        const caseSensitive = cfg.case_sensitive !== false

        let result = evalCondition(subject, subjectKey, operator, value, state.vars, caseSensitive)

        // Extra AND/OR conditions
        if (Array.isArray(cfg.extra_conditions)) {
          for (const extra of cfg.extra_conditions as Array<Record<string, unknown>>) {
            const r2 = evalCondition(
              String(extra.subject ?? 'var'),
              String(extra.subject_key ?? ''),
              String(extra.operator ?? 'equals'),
              typeof extra.value === 'string' ? extra.value : undefined,
              state.vars,
              caseSensitive,
            )
            result = extra.logical === 'or' ? result || r2 : result && r2
          }
        }

        key = next(result ? cfg.true_next : cfg.false_next)
        break
      }

      case 'ai_reply': {
        const stub = AI_STUBS[Math.floor(Math.random() * AI_STUBS.length)]
        const saveKey = typeof cfg.save_response_to === 'string' ? cfg.save_response_to : ''
        if (saveKey) state.vars[saveKey] = stub
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: `🤖 ${stub}`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'http_request': {
        const url = interp(typeof cfg.url === 'string' ? cfg.url : '(no url)', state.vars)
        const method = typeof cfg.method === 'string' ? cfg.method : 'GET'
        const mockPayload = JSON.stringify({ status: 'success', data: { id: 'mock_123', value: 'example' } }, null, 2)
        const varKey = typeof cfg.response_var === 'string' ? cfg.response_var : ''
        if (varKey) state.vars[varKey] = mockPayload
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `🔗 ${method} ${url}\n📦 Response: ${mockPayload}`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'delay': {
        const dur = typeof cfg.duration === 'number' ? cfg.duration : 3
        const unit = typeof cfg.unit === 'string' ? cfg.unit : 'seconds'
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `⏱ Waiting ${dur} ${unit}…`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'set_variable': {
        const assignments = Array.isArray(cfg.assignments)
          ? (cfg.assignments as Array<Record<string, unknown>>)
          : []
        for (const a of assignments) {
          const k = typeof a.var_key === 'string' ? a.var_key : ''
          const v = interp(typeof a.value === 'string' ? a.value : '', state.vars)
          if (k) state.vars[k] = v
        }
        key = next(cfg.next_node_key)
        break
      }

      case 'set_tag': {
        const mode = cfg.mode === 'remove' ? 'remove' : 'add'
        const tagId = typeof cfg.tag_id === 'string' ? cfg.tag_id : 'tag'
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `🏷 Tag "${tagId}" ${mode === 'add' ? 'added' : 'removed'}`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'update_contact': {
        const field = typeof cfg.field === 'string' ? cfg.field : 'field'
        const value = interp(typeof cfg.value === 'string' ? cfg.value : '', state.vars)
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `👤 Contact.${field} updated to "${value}"`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'handoff': {
        const note = typeof cfg.note === 'string' ? cfg.note : ''
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `👋 Transferring to a human agent${note ? `: ${note}` : ''}`,
          terminal: true,
        })
        state.done = true
        state.currentKey = null
        return state
      }

      case 'end': {
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: '✅ Conversation ended.',
          terminal: true,
        })
        state.done = true
        state.currentKey = null
        return state
      }

      case 'link_chatbot': {
        const name = typeof cfg.target_chatbot_name === 'string' && cfg.target_chatbot_name
          ? cfg.target_chatbot_name
          : 'another chatbot'
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `🔗 Switching to "${name}"… (preview ends here)`,
          terminal: true,
        })
        state.done = true
        state.currentKey = null
        return state
      }

      case 'send_flow': {
        const flowName = typeof cfg.flow_name === 'string' && cfg.flow_name
          ? cfg.flow_name
          : 'WhatsApp Flow'
        const btnText = typeof cfg.button_text === 'string' ? cfg.button_text : 'Open form'
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: `📋 ${flowName}`,
          buttons: [{ id: 'flow_open', label: btnText, nextKey: String(cfg.next_node_key ?? '') }],
        })
        state.currentKey = null
        return state
      }

      case 'send_template': {
        const tplName = typeof cfg.template_name === 'string' ? cfg.template_name : 'template'
        const lang = typeof cfg.language_code === 'string' ? cfg.language_code : 'en_US'
        state.msgs.push({
          id: uid(),
          role: 'bot',
          text: `📩 [Template: ${tplName} / ${lang}]`,
        })
        key = next(cfg.next_node_key)
        break
      }

      case 'join': {
        // Transparent pass-through — multiple branches converge here,
        // simulator just advances to next_node_key.
        key = next(cfg.next_node_key)
        break
      }

      case 'switch_case': {
        const variable = typeof cfg.variable === 'string' ? cfg.variable : ''
        const caseSensitive = cfg.case_sensitive === true
        // Resolve the variable value (stored as plain key, e.g. "choice")
        const rawValue = variable ? (state.vars[variable] ?? '') : ''
        const matchValue = caseSensitive ? rawValue : rawValue.toLowerCase()

        const cases = Array.isArray(cfg.cases)
          ? (cfg.cases as Array<Record<string, unknown>>)
          : []
        const matched = cases.find((c) => {
          const caseVal = typeof c.value === 'string' ? c.value : ''
          return caseSensitive ? caseVal === rawValue : caseVal.toLowerCase() === matchValue
        })

        key = next(matched ? matched.next_node_key : cfg.default_next)
        break
      }

      case 'send_to_number': {
        const phone = interp(typeof cfg.phone === 'string' ? cfg.phone : '(no number)', state.vars)
        const text = interp(typeof cfg.text === 'string' ? cfg.text : '', state.vars)
        state.msgs.push({
          id: uid(),
          role: 'system',
          text: `📲 Notification sent to ${phone}${text ? `: "${text}"` : ''}`,
        })
        key = next(cfg.next_node_key)
        break
      }

      default:
        key = null
    }
  }

  if (steps >= MAX_STEPS) {
    state.msgs.push({
      id: uid(),
      role: 'system',
      text: '⚠ Max steps reached — possible loop detected.',
      terminal: true,
    })
    state.done = true
    state.currentKey = null
  }

  return state
}

/** Apply a user button tap, returning an updated state + next run. */
export function applyButtonTap(
  nodes: ChatbotBuilderNode[],
  state: PlaygroundState,
  buttonLabel: string,
  nextKey: string,
  saveVarKey?: string,
): PlaygroundState {
  const withUserMsg: PlaygroundState = {
    ...state,
    vars: saveVarKey ? { ...state.vars, [saveVarKey]: buttonLabel } : state.vars,
    msgs: [
      ...state.msgs,
      { id: uid(), role: 'user', text: buttonLabel },
    ],
  }
  return runUntilInteractive(nodes, nextKey, withUserMsg)
}

/** Apply a user list option selection. */
export function applyListSelect(
  nodes: ChatbotBuilderNode[],
  state: PlaygroundState,
  optionLabel: string,
  nextKey: string,
  saveVarKey?: string,
): PlaygroundState {
  const withUserMsg: PlaygroundState = {
    ...state,
    vars: saveVarKey ? { ...state.vars, [saveVarKey]: optionLabel } : state.vars,
    msgs: [
      ...state.msgs,
      { id: uid(), role: 'user', text: optionLabel },
    ],
  }
  return runUntilInteractive(nodes, nextKey, withUserMsg)
}

/** Apply a free-text user input, storing it in vars. */
const SIM_VALIDATION_ERRORS: Record<string, string> = {
  number:  'Please enter a valid number.',
  email:   'Please enter a valid email address.',
  website: 'Please enter a valid website URL (e.g. https://example.com).',
  date:    'Please enter a date in YYYY-MM-DD format.',
  time:    'Please enter a time in HH:MM format.',
  phone:   'Please enter a valid phone number.',
}

function simValidate(inputType: string, value: string): boolean {
  const v = value.trim()
  switch (inputType) {
    case 'number':  return v !== '' && !isNaN(Number(v))
    case 'email':   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    case 'website': return /^(https?:\/\/|www\.).+\..+/.test(v)
    case 'date':    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))
    case 'time':    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(v)
    case 'phone':   return /^[\d\s+\-().]{6,}$/.test(v)
    default:        return true
  }
}

export function applyTextInput(
  nodes: ChatbotBuilderNode[],
  state: PlaygroundState,
  text: string,
  varKey: string,
  nextKey: string,
  inputType = 'text',
  errorMessage?: string,
): PlaygroundState {
  // Validate before accepting
  if (!simValidate(inputType, text)) {
    const errMsg = errorMessage || SIM_VALIDATION_ERRORS[inputType] || 'Invalid input. Please try again.'
    const lastMsg = state.msgs[state.msgs.length - 1]
    return {
      ...state,
      msgs: [
        ...state.msgs,
        { id: uid(), role: 'user', text },
        { id: uid(), role: 'bot', text: errMsg },
        // Re-show the same awaitInput prompt so the user can try again
        ...(lastMsg?.awaitInput
          ? [{ ...lastMsg, id: uid() }]
          : []),
      ],
    }
  }

  const withUserMsg: PlaygroundState = {
    ...state,
    vars: { ...state.vars, [varKey]: text },
    msgs: [
      ...state.msgs,
      { id: uid(), role: 'user', text },
    ],
  }
  return runUntilInteractive(nodes, nextKey, withUserMsg)
}

/** Bootstrap: create initial state and run from the entry node. */
export function startSimulation(
  nodes: ChatbotBuilderNode[],
  entryNodeId: string | null,
): PlaygroundState {
  const initial: PlaygroundState = {
    msgs: [],
    vars: {
      'contact.name': 'Demo User',
      'contact.phone': '+1234567890',
      'contact.email': 'demo@example.com',
    },
    currentKey: entryNodeId,
    waiting: false,
    done: false,
  }

  if (!entryNodeId) {
    return {
      ...initial,
      msgs: [{ id: uid(), role: 'system', text: '⚠ No entry node selected. Set one in the canvas.' }],
      done: true,
    }
  }

  return runUntilInteractive(nodes, entryNodeId, initial)
}
