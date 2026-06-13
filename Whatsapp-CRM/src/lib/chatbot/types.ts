/**
 * Chatbot builder — node config discriminated union.
 */

// ─── Node-type union ────────────────────────────────────────────
export type ChatbotNodeType =
  | 'start'
  | 'send_text'
  | 'send_buttons'
  | 'send_list'
  | 'send_media'
  | 'collect_input'
  | 'condition'
  | 'ai_reply'
  | 'http_request'
  | 'delay'
  | 'set_variable'
  | 'set_tag'
  | 'update_contact'
  | 'handoff'
  | 'end'
  | 'link_chatbot'
  | 'send_flow'
  | 'send_template'
  | 'join'

// ─── Shared primitives ──────────────────────────────────────────

export interface ChatbotButton {
  reply_id: string
  title: string          // ≤ 20 chars (Meta limit)
  next_node_key: string
}

export interface ChatbotListRow {
  reply_id: string
  title: string          // ≤ 24 chars
  description?: string   // ≤ 72 chars
  next_node_key: string
}

export interface ChatbotListSection {
  title?: string
  rows: ChatbotListRow[]
}

// ─── Per-node config interfaces ─────────────────────────────────

export interface StartNodeCfg {
  next_node_key: string
  /** Keyword that triggers this chatbot. Empty = always triggers (no filter). */
  trigger_keyword?: string
  trigger_match?: 'exact' | 'contains' | 'starts_with'
}

export interface SendTextNodeCfg {
  /** Supports {{vars.name}}, {{contact.phone}}, {{contact.email}} interpolation */
  text: string
  header_text?: string
  footer_text?: string
  next_node_key: string
}

export interface SendButtonsNodeCfg {
  text: string
  header_text?: string
  footer_text?: string
  /** 1–3 buttons (Meta cap) */
  buttons: ChatbotButton[]
}

export interface SendListNodeCfg {
  text: string
  button_label: string   // label on the "tap to open" button
  header_text?: string
  footer_text?: string
  /** ≤ 10 rows total across all sections */
  sections: ChatbotListSection[]
}

export interface SendMediaNodeCfg {
  media_type: 'image' | 'video' | 'document' | 'audio'
  media_url: string
  filename?: string      // documents only
  caption?: string
  next_node_key: string
}

export interface CollectInputNodeCfg {
  prompt_text: string
  /** Variable key to store the answer under (accessed as {{vars.key}}) */
  var_key: string
  input_type: 'text' | 'number' | 'email' | 'website' | 'date' | 'time' | 'phone' | 'file' | 'location'
  /** Optional regex or min/max for number validation */
  validation?: {
    pattern?: string
    min?: number
    max?: number
    error_message?: string
  }
  next_node_key: string
}

export interface ConditionNodeCfg {
  subject: 'var' | 'tag' | 'contact_field'
  subject_key: string
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'present' | 'absent' | 'gt' | 'lt' | 'gte' | 'lte'
  value?: string
  /** Support AND / OR chains */
  extra_conditions?: Array<{
    logical: 'and' | 'or'
    subject: 'var' | 'tag' | 'contact_field'
    subject_key: string
    operator: ConditionNodeCfg['operator']
    value?: string
  }>
  true_next: string
  false_next: string
}

export interface AiReplyNodeCfg {
  /** System-level instructions for the AI */
  system_prompt: string
  /** Optional: inject conversation history context */
  include_history: boolean
  /** Number of past messages to include (1–20) */
  history_depth?: number
  /** Max tokens for the AI response */
  max_tokens?: number
  /** Save the AI response text to this variable */
  save_response_to?: string
  next_node_key: string
}

export interface HttpRequestNodeCfg {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string                               // supports {{vars.x}} interpolation
  headers?: Record<string, string>
  body?: string                             // JSON template string
  /** JSONPath expression to extract from response, e.g. "$.data.id" */
  response_var?: string                     // variable key to store result
  /** Advance on success */
  next_node_key: string
  /** Advance on HTTP error (4xx/5xx) — falls through to next if omitted */
  error_node_key?: string
}

export interface DelayNodeCfg {
  /** How long to wait */
  duration: number
  unit: 'seconds' | 'minutes' | 'hours'
  /** Optional: show a "typing..." indicator to the user during delay */
  show_typing: boolean
  next_node_key: string
}

export interface SetVariableNodeCfg {
  assignments: Array<{
    var_key: string
    /** Literal value, or use {{vars.x}} / {{contact.field}} for computed */
    value: string
  }>
  next_node_key: string
}

export interface SetTagNodeCfg {
  mode: 'add' | 'remove'
  tag_id: string
  next_node_key: string
}

export interface UpdateContactNodeCfg {
  field: string          // e.g. "name", "email", "phone", or custom field key
  value: string          // supports {{vars.x}} interpolation
  next_node_key: string
}

export interface HandoffNodeCfg {
  note?: string
  assign_to_user_id?: string    // optional specific agent
}

export interface EndNodeCfg {
  close_conversation?: boolean
}

export interface LinkChatbotNodeCfg {
  /** The chatbot template to jump to */
  target_chatbot_id: string
  target_chatbot_name?: string
}

export interface SendFlowNodeCfg {
  /** Meta WhatsApp Flow ID */
  flow_id: string
  flow_name?: string
  /** Button text the user taps to open the flow */
  button_text: string
  next_node_key: string
}

export interface SendTemplateNodeCfg {
  /** Template name as registered in Meta Business Manager */
  template_name: string
  /** Language code e.g. "en_US", "ar", "pt_BR" */
  language_code: string
  /** Comma-separated variable values to replace {{1}}, {{2}} in body */
  body_params?: string
  next_node_key: string
}

export interface JoinNodeCfg {
  /** Optional label to describe what flows are converging here */
  label?: string
  next_node_key: string
}

// ─── Discriminated union ────────────────────────────────────────

export type ChatbotNodeConfig =
  | ({ node_type: 'start' } & StartNodeCfg)
  | ({ node_type: 'send_text' } & SendTextNodeCfg)
  | ({ node_type: 'send_buttons' } & SendButtonsNodeCfg)
  | ({ node_type: 'send_list' } & SendListNodeCfg)
  | ({ node_type: 'send_media' } & SendMediaNodeCfg)
  | ({ node_type: 'collect_input' } & CollectInputNodeCfg)
  | ({ node_type: 'condition' } & ConditionNodeCfg)
  | ({ node_type: 'ai_reply' } & AiReplyNodeCfg)
  | ({ node_type: 'http_request' } & HttpRequestNodeCfg)
  | ({ node_type: 'delay' } & DelayNodeCfg)
  | ({ node_type: 'set_variable' } & SetVariableNodeCfg)
  | ({ node_type: 'set_tag' } & SetTagNodeCfg)
  | ({ node_type: 'update_contact' } & UpdateContactNodeCfg)
  | ({ node_type: 'handoff' } & HandoffNodeCfg)
  | ({ node_type: 'end' } & EndNodeCfg)
  | ({ node_type: 'link_chatbot' } & LinkChatbotNodeCfg)
  | ({ node_type: 'send_flow' } & SendFlowNodeCfg)
  | ({ node_type: 'send_template' } & SendTemplateNodeCfg)
  | ({ node_type: 'join' } & JoinNodeCfg)

// ─── Builder node (client state) ───────────────────────────────

export interface ChatbotBuilderNode {
  node_key: string
  node_type: ChatbotNodeType
  config: Record<string, unknown>
  position_x: number
  position_y: number
}

// ─── Editor state ───────────────────────────────────────────────

export interface ChatbotBuilderState {
  id: string
  name: string
  description: string
  trigger_type: 'always' | 'keyword' | 'manual'
  trigger_config: Record<string, unknown>
  entry_node_id: string | null
  status: 'draft' | 'active' | 'archived'
  nodes: ChatbotBuilderNode[]
}

// ─── Trigger configs ────────────────────────────────────────────

export interface KeywordTriggerConfig {
  keywords: string[]
  match_type: 'exact' | 'contains' | 'starts_with'
  case_sensitive: boolean
}

// ─── Helpers ────────────────────────────────────────────────────

export const CHATBOT_NODE_TYPES = [
  'start', 'send_text', 'send_buttons', 'send_list', 'send_media',
  'collect_input', 'condition', 'ai_reply', 'http_request', 'delay',
  'set_variable', 'set_tag', 'update_contact', 'handoff', 'end',
  'link_chatbot', 'send_flow', 'send_template', 'join',
] as const satisfies readonly ChatbotNodeType[]

export function isChatbotNodeType(v: unknown): v is ChatbotNodeType {
  return typeof v === 'string' && (CHATBOT_NODE_TYPES as readonly string[]).includes(v)
}

/** Default empty config for each node type — used when adding new nodes. */
export function defaultConfigFor(type: ChatbotNodeType): Record<string, unknown> {
  switch (type) {
    case 'start':        return { next_node_key: '', trigger_keyword: '', trigger_match: 'exact' }
    case 'send_text':    return { text: '', next_node_key: '' }
    case 'send_buttons': return { text: '', buttons: [{ reply_id: 'btn_1', title: 'Option 1', next_node_key: '' }] }
    case 'send_list':    return { text: '', button_label: 'View options', sections: [{ title: '', rows: [{ reply_id: 'row_1', title: 'Option 1', next_node_key: '' }] }] }
    case 'send_media':   return { media_type: 'image', media_url: '', next_node_key: '' }
    case 'collect_input': return { prompt_text: '', var_key: '', input_type: 'text', next_node_key: '' }
    case 'condition':    return { subject: 'var', subject_key: '', operator: 'equals', value: '', true_next: '', false_next: '' }
    case 'ai_reply':     return { system_prompt: 'You are a helpful customer support assistant.', include_history: true, history_depth: 5, max_tokens: 300, next_node_key: '' }
    case 'http_request': return { method: 'GET', url: '', next_node_key: '' }
    case 'delay':        return { duration: 3, unit: 'seconds', show_typing: true, next_node_key: '' }
    case 'set_variable': return { assignments: [{ var_key: '', value: '' }], next_node_key: '' }
    case 'set_tag':      return { mode: 'add', tag_id: '', next_node_key: '' }
    case 'update_contact': return { field: 'name', value: '', next_node_key: '' }
    case 'handoff':      return { note: '' }
    case 'end':          return { close_conversation: false }
    case 'link_chatbot': return { target_chatbot_id: '', target_chatbot_name: '' }
    case 'send_flow':    return { flow_id: '', flow_name: '', button_text: 'Open form', next_node_key: '' }
    case 'send_template': return { template_name: '', language_code: 'en_US', body_params: '', next_node_key: '' }
    case 'join':          return { label: '', next_node_key: '' }
  }
}
