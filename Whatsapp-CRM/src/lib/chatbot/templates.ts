import type { ChatbotBuilderNode } from './types'

export interface ChatbotTemplate {
  slug: string
  name: string
  description: string
  emoji: string
  trigger_type: 'always' | 'keyword' | 'manual'
  trigger_config: Record<string, unknown>
  entry_node_id: string
  nodes: ChatbotBuilderNode[]
}

// ─── Helper to lay out nodes in a vertical tree ─────────────────
function pos(col: number, row: number) {
  return { position_x: col * 320, position_y: row * 180 }
}

// ─── Template 1: Welcome & FAQ ──────────────────────────────────
const welcomeFaq: ChatbotTemplate = {
  slug: 'welcome_faq',
  name: 'Welcome & FAQ',
  description: 'Greet new customers and guide them to support, pricing, or a human agent.',
  emoji: '👋',
  trigger_type: 'always',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'greet' },
      ...pos(1, 0),
    },
    {
      node_key: 'greet',
      node_type: 'send_text',
      config: {
        text: 'Hi {{contact.name}} 👋 Welcome! How can we help you today?',
        next_node_key: 'main_menu',
      },
      ...pos(1, 1),
    },
    {
      node_key: 'main_menu',
      node_type: 'send_buttons',
      config: {
        text: 'Please choose an option:',
        buttons: [
          { reply_id: 'support', title: '🛠 Support', next_node_key: 'support_msg' },
          { reply_id: 'pricing', title: '💰 Pricing', next_node_key: 'pricing_msg' },
          { reply_id: 'agent',   title: '👤 Talk to Agent', next_node_key: 'handoff_node' },
        ],
      },
      ...pos(1, 2),
    },
    {
      node_key: 'support_msg',
      node_type: 'send_text',
      config: {
        text: 'For support, please visit our Help Centre at https://help.example.com or reply with your issue and we\'ll get back to you within 2 hours.',
        next_node_key: 'end_node',
      },
      ...pos(0, 3),
    },
    {
      node_key: 'pricing_msg',
      node_type: 'send_text',
      config: {
        text: 'Our plans start from $29/month. Reply "PRICING" to receive our full pricing guide, or visit https://example.com/pricing',
        next_node_key: 'end_node',
      },
      ...pos(1, 3),
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: { note: 'Customer requested agent from welcome flow' },
      ...pos(2, 3),
    },
    {
      node_key: 'end_node',
      node_type: 'end',
      config: { close_conversation: false },
      ...pos(0.5, 4),
    },
  ],
}

// ─── Template 2: Lead Qualifier ─────────────────────────────────
const leadQualifier: ChatbotTemplate = {
  slug: 'lead_qualifier',
  name: 'Lead Qualifier',
  description: 'Collect contact details, qualify intent, and route hot leads to your team.',
  emoji: '🎯',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hi', 'hello', 'start', 'info'], match_type: 'contains', case_sensitive: false },
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'intro' },
      ...pos(1, 0),
    },
    {
      node_key: 'intro',
      node_type: 'send_text',
      config: { text: 'Hi there! 👋 I\'m here to help you find the right solution. This will only take 2 minutes.', next_node_key: 'ask_name' },
      ...pos(1, 1),
    },
    {
      node_key: 'ask_name',
      node_type: 'collect_input',
      config: { prompt_text: 'What\'s your full name?', var_key: 'name', input_type: 'text', next_node_key: 'ask_company' },
      ...pos(1, 2),
    },
    {
      node_key: 'ask_company',
      node_type: 'collect_input',
      config: { prompt_text: 'Which company are you from, {{vars.name}}?', var_key: 'company', input_type: 'text', next_node_key: 'ask_intent' },
      ...pos(1, 3),
    },
    {
      node_key: 'ask_intent',
      node_type: 'send_list',
      config: {
        text: 'What are you looking for, {{vars.name}} from {{vars.company}}?',
        button_label: 'View options',
        sections: [{
          title: 'Your goal',
          rows: [
            { reply_id: 'buy',   title: '🛒 Purchase a product',   next_node_key: 'hot_lead' },
            { reply_id: 'demo',  title: '📅 Request a demo',       next_node_key: 'hot_lead' },
            { reply_id: 'info',  title: 'ℹ Just browsing',        next_node_key: 'cold_lead' },
            { reply_id: 'other', title: '💬 Something else',      next_node_key: 'agent_handoff' },
          ],
        }],
      },
      ...pos(1, 4),
    },
    {
      node_key: 'hot_lead',
      node_type: 'set_tag',
      config: { mode: 'add', tag_id: 'hot_lead', next_node_key: 'agent_handoff' },
      ...pos(0, 5),
    },
    {
      node_key: 'cold_lead',
      node_type: 'send_text',
      config: { text: 'No problem! Check out our website at https://example.com for more information. Feel free to come back when you\'re ready 😊', next_node_key: 'end_node' },
      ...pos(2, 5),
    },
    {
      node_key: 'agent_handoff',
      node_type: 'handoff',
      config: { note: 'Qualified lead — {{vars.name}} from {{vars.company}}' },
      ...pos(0, 6),
    },
    {
      node_key: 'end_node',
      node_type: 'end',
      config: { close_conversation: false },
      ...pos(2, 6),
    },
  ],
}

// ─── Template 3: Order Tracking ─────────────────────────────────
const orderTracking: ChatbotTemplate = {
  slug: 'order_tracking',
  name: 'Order Tracking',
  description: 'Collect an order number, call your API, and return real-time order status.',
  emoji: '📦',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['order', 'track', 'tracking', 'delivery'], match_type: 'contains', case_sensitive: false },
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'ask_order' },
      ...pos(1, 0),
    },
    {
      node_key: 'ask_order',
      node_type: 'collect_input',
      config: { prompt_text: 'Please enter your order number (e.g. ORD-12345):', var_key: 'order_id', input_type: 'text', next_node_key: 'fetch_order' },
      ...pos(1, 1),
    },
    {
      node_key: 'fetch_order',
      node_type: 'http_request',
      config: {
        method: 'GET',
        url: 'https://api.example.com/orders/{{vars.order_id}}',
        response_var: 'order_data',
        next_node_key: 'show_status',
        error_node_key: 'not_found',
      },
      ...pos(1, 2),
    },
    {
      node_key: 'show_status',
      node_type: 'send_text',
      config: { text: '📦 Your order {{vars.order_id}} is currently *In Transit*.\nEstimated delivery: Tomorrow by 6pm.\n\nTracking: https://track.example.com/{{vars.order_id}}', next_node_key: 'anything_else' },
      ...pos(0, 3),
    },
    {
      node_key: 'not_found',
      node_type: 'send_text',
      config: { text: 'Sorry, we couldn\'t find order "{{vars.order_id}}". Please double-check the number or contact our support team.', next_node_key: 'anything_else' },
      ...pos(2, 3),
    },
    {
      node_key: 'anything_else',
      node_type: 'send_buttons',
      config: {
        text: 'Is there anything else I can help with?',
        buttons: [
          { reply_id: 'another', title: '🔍 Track Another', next_node_key: 'ask_order' },
          { reply_id: 'agent',   title: '👤 Talk to Agent', next_node_key: 'handoff_node' },
          { reply_id: 'done',    title: '✅ No, thanks',    next_node_key: 'end_node' },
        ],
      },
      ...pos(1, 4),
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: { note: 'Customer needs help with order {{vars.order_id}}' },
      ...pos(0, 5),
    },
    {
      node_key: 'end_node',
      node_type: 'end',
      config: { close_conversation: false },
      ...pos(2, 5),
    },
  ],
}

// ─── Template 4: AI Customer Support ────────────────────────────
const aiSupport: ChatbotTemplate = {
  slug: 'ai_support',
  name: 'AI Customer Support',
  description: 'Use GPT to answer questions intelligently, with human escalation fallback.',
  emoji: '🤖',
  trigger_type: 'always',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'welcome' },
      ...pos(1, 0),
    },
    {
      node_key: 'welcome',
      node_type: 'send_text',
      config: { text: 'Hello! 🤖 I\'m your AI assistant. Ask me anything about our products and services.', next_node_key: 'collect_question' },
      ...pos(1, 1),
    },
    {
      node_key: 'collect_question',
      node_type: 'collect_input',
      config: { prompt_text: 'What can I help you with today?', var_key: 'user_question', input_type: 'text', next_node_key: 'ai_response' },
      ...pos(1, 2),
    },
    {
      node_key: 'ai_response',
      node_type: 'ai_reply',
      config: {
        system_prompt: 'You are a helpful customer support agent. Answer the user\'s question clearly and concisely in 2-3 sentences. If you cannot help, say so politely.',
        include_history: true,
        history_depth: 5,
        max_tokens: 300,
        save_response_to: 'ai_answer',
        next_node_key: 'satisfied',
      },
      ...pos(1, 3),
    },
    {
      node_key: 'satisfied',
      node_type: 'send_buttons',
      config: {
        text: 'Did that answer your question?',
        buttons: [
          { reply_id: 'yes',     title: '✅ Yes, thanks!',    next_node_key: 'end_node' },
          { reply_id: 'more',    title: '❓ Ask another',      next_node_key: 'collect_question' },
          { reply_id: 'agent',   title: '👤 Human agent',     next_node_key: 'handoff_node' },
        ],
      },
      ...pos(1, 4),
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: { note: 'Customer question: {{vars.user_question}}' },
      ...pos(2, 5),
    },
    {
      node_key: 'end_node',
      node_type: 'end',
      config: { close_conversation: false },
      ...pos(0, 5),
    },
  ],
}

// ─── Registry ───────────────────────────────────────────────────

export const CHATBOT_TEMPLATES: ChatbotTemplate[] = [
  welcomeFaq,
  leadQualifier,
  orderTracking,
  aiSupport,
]

export function getChatbotTemplate(slug: string): ChatbotTemplate | undefined {
  return CHATBOT_TEMPLATES.find((t) => t.slug === slug)
}
