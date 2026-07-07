import {
  Clock,
  Code2,
  ExternalLink,
  FileText,
  Flag,
  GitMerge,
  Globe,
  Inbox,
  Layers,
  ListChecks,
  ListPlus,
  MessageCircle,
  Paperclip,
  PhoneCall,
  PlayCircle,
  Sparkles,
  Tag,
  UserCog,
  UserPlus,
  GitFork,
  Briefcase,
  Waypoints,
} from 'lucide-react'
import type { ChatbotNodeType } from './types'

// ─── Visual metadata per node type ─────────────────────────────

export interface NodeMeta {
  label: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>
  /** Tailwind text color used for the icon + border accent */
  color: string
  /** Tailwind bg color used for the node header strip */
  bg: string
  /** Palette group */
  group: PaletteGroup
}

export type PaletteGroup =
  | 'Messaging'
  | 'Interactive'
  | 'Logic'
  | 'AI & Integrations'
  | 'CRM Actions'
  | 'Control'

export const NODE_META: Record<ChatbotNodeType, NodeMeta> = {
  start: {
    label: 'Start',
    description: 'Entry point of the chatbot flow',
    icon: PlayCircle,
    color: 'text-emerald-500',
    bg: 'bg-emerald-50',
    group: 'Control',
  },
  send_text: {
    label: 'Send Text',
    description: 'Send a plain text message with optional header/footer',
    icon: MessageCircle,
    color: 'text-sky-500',
    bg: 'bg-sky-50',
    group: 'Messaging',
  },
  send_buttons: {
    label: 'Send Buttons',
    description: 'Send up to 3 quick-reply buttons for user selection',
    icon: ListChecks,
    color: 'text-primary',
    bg: 'bg-primary/5',
    group: 'Interactive',
  },
  send_list: {
    label: 'Send List',
    description: 'Send a scrollable list menu with up to 10 options',
    icon: ListPlus,
    color: 'text-indigo-500',
    bg: 'bg-indigo-50',
    group: 'Interactive',
  },
  send_media: {
    label: 'Send Media',
    description: 'Send an image, video, audio clip, or document',
    icon: Paperclip,
    color: 'text-cyan-500',
    bg: 'bg-cyan-50',
    group: 'Messaging',
  },
  collect_input: {
    label: 'Collect Input',
    description: 'Ask the user a question and save their reply to a variable',
    icon: Inbox,
    color: 'text-teal-500',
    bg: 'bg-teal-50',
    group: 'Interactive',
  },
  condition: {
    label: 'Condition',
    description: 'Branch the flow based on variables, tags, or contact fields',
    icon: GitFork,
    color: 'text-fuchsia-500',
    bg: 'bg-fuchsia-50',
    group: 'Logic',
  },
  ai_reply: {
    label: 'AI Reply',
    description: 'Generate a context-aware response using OpenAI GPT',
    icon: Sparkles,
    color: 'text-violet-500',
    bg: 'bg-violet-50',
    group: 'AI & Integrations',
  },
  http_request: {
    label: 'HTTP Request',
    description: 'Call an external REST API and save the response to a variable',
    icon: Globe,
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    group: 'AI & Integrations',
  },
  delay: {
    label: 'Delay',
    description: 'Pause the flow for a set duration before continuing',
    icon: Clock,
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    group: 'Logic',
  },
  set_variable: {
    label: 'Set Variable',
    description: 'Create or update flow variables for use in later nodes',
    icon: Code2,
    color: 'text-slate-500',
    bg: 'bg-muted',
    group: 'Logic',
  },
  set_tag: {
    label: 'Tag Contact',
    description: 'Add or remove a tag on the contact record',
    icon: Tag,
    color: 'text-pink-500',
    bg: 'bg-pink-50',
    group: 'CRM Actions',
  },
  update_contact: {
    label: 'Update Contact',
    description: 'Write a value to a contact field (name, email, phone, custom)',
    icon: UserCog,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    group: 'CRM Actions',
  },
  crm_action: {
    label: 'CRM Action',
    description: 'Create a lead, add to segment, create a follow-up, or add a task for this contact',
    icon: Briefcase,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    group: 'CRM Actions',
  },
  handoff: {
    label: 'Handoff',
    description: 'Transfer the conversation to a human agent',
    icon: UserPlus,
    color: 'text-rose-500',
    bg: 'bg-rose-50',
    group: 'Control',
  },
  end: {
    label: 'End',
    description: 'Finish the chatbot flow (optionally close the conversation)',
    icon: Flag,
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    group: 'Control',
  },
  link_chatbot: {
    label: 'Link Chatbot',
    description: 'Jump to another chatbot template',
    icon: ExternalLink,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    group: 'Control',
  },
  send_flow: {
    label: 'Send Flow',
    description: 'Send a Meta WhatsApp Flow form to the user',
    icon: Layers,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    group: 'Messaging',
  },
  send_template: {
    label: 'Send Template',
    description: 'Send a pre-approved WhatsApp message template',
    icon: FileText,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    group: 'Messaging',
  },
  join: {
    label: 'Join',
    description: 'Merge multiple branches into a single flow path',
    icon: GitMerge,
    color: 'text-indigo-500',
    bg: 'bg-indigo-50',
    group: 'Logic',
  },
  switch_case: {
    label: 'Switch / Case',
    description: 'Route flow to different branches based on the exact value of a variable',
    icon: Waypoints,
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
    group: 'Logic',
  },
  send_to_number: {
    label: 'Send to Number',
    description: 'Send a WhatsApp message to a specific phone number (admin notification)',
    icon: PhoneCall,
    color: 'text-green-600',
    bg: 'bg-green-50',
    group: 'Messaging',
  },
}

// ─── Palette groups in display order ────────────────────────────

export const PALETTE_GROUPS: PaletteGroup[] = [
  'Messaging',
  'Interactive',
  'Logic',
  'AI & Integrations',
  'CRM Actions',
  'Control',
]

export const PALETTE_GROUP_COLORS: Record<PaletteGroup, string> = {
  Messaging:           'text-sky-600',
  Interactive:         'text-primary',
  Logic:               'text-fuchsia-600',
  'AI & Integrations': 'text-violet-600',
  'CRM Actions':       'text-blue-600',
  Control:             'text-emerald-600',
}

/** All node types that can be dragged from the palette (excludes 'start'). */
export const PALETTE_NODES: ChatbotNodeType[] = [
  'send_text', 'send_buttons', 'send_list', 'send_media',
  'send_flow', 'send_template', 'send_to_number',
  'collect_input',
  'condition', 'switch_case', 'join', 'delay', 'set_variable',
  'ai_reply', 'http_request',
  'set_tag', 'update_contact', 'crm_action',
  'handoff', 'link_chatbot', 'end',
]

// ─── Handle (edge port) definitions per node type ───────────────

export type HandleDef =
  | { id: string; kind: 'source'; label?: string }
  | { id: string; kind: 'target'; label?: string }

export function getSourceHandles(
  nodeType: ChatbotNodeType,
  config: Record<string, unknown>,
): Array<{ id: string; label?: string }> {
  switch (nodeType) {
    case 'end':
    case 'handoff':
    case 'link_chatbot':
      return []
    case 'condition': {
      return [
        { id: 'true', label: '✓ True' },
        { id: 'false', label: '✗ False' },
      ]
    }
    case 'send_buttons': {
      const buttons = Array.isArray(config.buttons)
        ? (config.buttons as Array<Record<string, unknown>>)
        : []
      if (buttons.length === 0) return [{ id: 'btn_0' }]
      return buttons.map((b, i) => ({
        id: `btn_${String(b.reply_id ?? i)}`,
        label: typeof b.title === 'string' && b.title ? b.title : `Button ${i + 1}`,
      }))
    }
    case 'send_list': {
      const sections = Array.isArray(config.sections)
        ? (config.sections as Array<Record<string, unknown>>)
        : []
      const rows: Array<{ id: string; label?: string }> = []
      for (const section of sections) {
        const sRows = Array.isArray(section.rows)
          ? (section.rows as Array<Record<string, unknown>>)
          : []
        for (const row of sRows) {
          rows.push({
            id: `row_${String(row.reply_id ?? rows.length)}`,
            label: typeof row.title === 'string' ? row.title : undefined,
          })
        }
      }
      return rows.length > 0 ? rows : [{ id: 'row_0' }]
    }
    case 'http_request': {
      const handles: Array<{ id: string; label?: string }> = [{ id: 'next', label: 'Success' }]
      if (config.error_node_key) handles.push({ id: 'error', label: 'Error' })
      return handles
    }
    case 'switch_case': {
      const cases = Array.isArray(config.cases)
        ? (config.cases as Array<Record<string, unknown>>)
        : []
      const handles: Array<{ id: string; label?: string }> = cases.map((c, i) => ({
        id: `case_${i}`,
        label: (typeof c.label === 'string' && c.label)
          || (typeof c.value === 'string' && c.value)
          || `Case ${i + 1}`,
      }))
      handles.push({ id: 'default', label: 'Default' })
      return handles
    }
    default:
      return [{ id: 'next' }]
  }
}

// ─── One-line summary for node tiles ────────────────────────────

export function summarizeChatbotNode(
  nodeType: ChatbotNodeType,
  config: Record<string, unknown>,
): string | null {
  const t = (s: unknown, max = 60) => {
    const str = typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : ''
    return str.length > max ? str.slice(0, max - 1) + '…' : str || null
  }
  switch (nodeType) {
    case 'start':
    case 'end':
      return null
    case 'send_text':
      return t(config.text)
    case 'send_buttons': {
      const text = t(config.text, 30)
      const btns = Array.isArray(config.buttons)
        ? (config.buttons as Array<Record<string, unknown>>)
            .map((b) => (typeof b.title === 'string' ? b.title : ''))
            .filter(Boolean)
            .join(' / ')
        : ''
      return text ? (btns ? `${text} · ${btns}` : text) : btns || null
    }
    case 'send_list': {
      const text = t(config.text, 30)
      const sections = Array.isArray(config.sections) ? config.sections as Array<Record<string, unknown>> : []
      const count = sections.reduce((n, s) => n + (Array.isArray(s.rows) ? s.rows.length : 0), 0)
      return text ? (count ? `${text} · ${count} options` : text) : count ? `${count} options` : null
    }
    case 'send_media': {
      const mt = typeof config.media_type === 'string' ? config.media_type : 'media'
      const cap = t(config.caption, 40)
      return cap ? `${mt}: ${cap}` : mt
    }
    case 'collect_input': {
      const prompt = t(config.prompt_text, 40)
      const vk = typeof config.var_key === 'string' ? config.var_key : ''
      const it = typeof config.input_type === 'string' ? config.input_type : 'text'
      return prompt ? (vk ? `${prompt} → {{${vk}}}` : prompt) : vk ? `[${it}] → {{${vk}}}` : null
    }
    case 'condition': {
      const sk = typeof config.subject_key === 'string' ? config.subject_key : ''
      const op = typeof config.operator === 'string' ? config.operator : ''
      const val = typeof config.value === 'string' ? config.value : ''
      if (!sk) return null
      return val ? `${sk} ${op} "${t(val, 20)}"` : `${sk} ${op}`
    }
    case 'ai_reply': {
      const sp = t(config.system_prompt, 50)
      return sp ? `GPT: ${sp}` : 'AI-powered reply'
    }
    case 'http_request': {
      const method = typeof config.method === 'string' ? config.method : 'GET'
      const url = t(config.url, 40)
      return url ? `${method} ${url}` : `${method} (no URL)`
    }
    case 'delay': {
      const dur = typeof config.duration === 'number' ? config.duration : '?'
      const unit = typeof config.unit === 'string' ? config.unit : 'seconds'
      return `Wait ${dur} ${unit}`
    }
    case 'set_variable': {
      const assignments = Array.isArray(config.assignments)
        ? (config.assignments as Array<Record<string, unknown>>)
        : []
      return assignments.length
        ? assignments.map((a) => `${a.var_key} = ${a.value}`).slice(0, 2).join(', ')
        : null
    }
    case 'set_tag': {
      const mode = config.mode === 'remove' ? 'Remove' : 'Add'
      return `${mode} tag`
    }
    case 'update_contact': {
      const field = typeof config.field === 'string' ? config.field : ''
      const val = t(config.value, 30)
      return field ? `${field} = ${val ?? '…'}` : null
    }
    case 'crm_action': {
      const action = typeof config.action === 'string' ? config.action : ''
      if (action === 'create_lead') {
        const mode = config.lead_mode === 'create_new' ? 'Always create lead' : 'Create or update lead'
        return mode
      }
      const labels: Record<string, string> = {
        add_to_segment: 'Add to segment',
        create_followup: 'Create follow-up',
        create_task: 'Create task',
      }
      return labels[action] ?? 'CRM action'
    }
    case 'handoff': {
      const note = t(config.note, 50)
      return note ?? 'Transfer to agent'
    }
    case 'link_chatbot': {
      const name = typeof config.target_chatbot_name === 'string' ? config.target_chatbot_name : ''
      return name ? `→ ${name}` : 'Link to chatbot'
    }
    case 'send_flow': {
      const name = typeof config.flow_name === 'string' ? config.flow_name : ''
      const btn = typeof config.button_text === 'string' ? config.button_text : ''
      return name ? `Flow: ${name}` : btn ? `Button: ${btn}` : 'Send WhatsApp Flow'
    }
    case 'send_template': {
      const name = typeof config.template_name === 'string' ? config.template_name : ''
      const lang = typeof config.language_code === 'string' ? config.language_code : ''
      return name ? `${name}${lang ? ` (${lang})` : ''}` : 'Send template'
    }
    case 'join': {
      const label = t(config.label, 40)
      return label ?? 'Merge branches here'
    }
    case 'switch_case': {
      const varKey = typeof config.variable === 'string' ? config.variable : ''
      const cases = Array.isArray(config.cases) ? config.cases as Array<Record<string, unknown>> : []
      return varKey
        ? `${varKey} → ${cases.length} case${cases.length !== 1 ? 's' : ''}`
        : cases.length ? `${cases.length} cases` : null
    }
    case 'send_to_number': {
      const phone = typeof config.phone === 'string' ? config.phone : ''
      const txt = t(config.text, 30)
      return phone ? (txt ? `→ ${phone}: ${txt}` : `→ ${phone}`) : txt ?? null
    }
  }
}

// Need React import for ComponentType
import type React from 'react'
