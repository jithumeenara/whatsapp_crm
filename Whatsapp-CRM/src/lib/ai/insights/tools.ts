/**
 * The read-only data tools the Admin Test assistant is allowed to call.
 *
 * The hard rule this file exists to enforce: **the model never writes a
 * query.** It picks a tool name and arguments from the fixed list below;
 * every actual database call is hand-written here and unconditionally
 * filtered by account_id. There is no free-form SQL path, no table name
 * taken from model output, and nothing here mutates data — the worst a
 * confused or adversarial prompt can achieve is asking for a count it
 * was already entitled to see.
 *
 * Scope is deliberately aggregate-first. Counts, breakdowns and short
 * recent lists answer the questions an owner actually asks ("how many
 * enquiries this month, by source?") without shipping the whole contact
 * database into a prompt. Where individual records are returned at all,
 * the set is small, capped, and limited to fields already visible on the
 * screens this account's admins use.
 */

import {
  SchemaType,
  type FunctionDeclaration,
  type FunctionDeclarationSchemaProperty,
} from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { loadKnowledge } from '../knowledge-store'
import { selectRelevantContext } from '../knowledge'

export interface ToolContext {
  accountId: string
}

type ToolArgs = Record<string, unknown>

interface ToolImpl {
  declaration: FunctionDeclaration
  run: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>
}

/** Resolves a "last N days" style window. Null/absent means all time,
 *  which is what "in total" questions want. */
function sinceFrom(args: ToolArgs): Date | undefined {
  const days = Number(args.days_back)
  if (!Number.isFinite(days) || days <= 0) return undefined
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function withPercentages(rows: Array<{ label: string; count: number }>) {
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  return {
    total,
    rows: rows
      .sort((a, b) => b.count - a.count)
      .map((r) => ({
        ...r,
        percentage: total > 0 ? `${Math.round((r.count / total) * 100)}%` : '0%',
      })),
  }
}

const DAYS_BACK_PARAM: FunctionDeclarationSchemaProperty = {
  type: SchemaType.NUMBER,
  description: 'Optional. Only count records created in the last N days. Omit for all time.',
}

const TOOLS: Record<string, ToolImpl> = {
  account_overview: {
    declaration: {
      name: 'account_overview',
      description:
        'High-level counts across every module of this CRM: contacts, conversations, messages, enquiries/leads, templates, chatbot flows, automations, data tables and knowledge base entries. Use this to answer "what is in the system" or to orient before a more specific question.',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const [contacts, conversations, messages, leads, templates, flows, automations, tables, knowledge] =
        await Promise.all([
          prisma.contact.count({ where: { account_id: ctx.accountId } }),
          prisma.conversation.count({ where: { account_id: ctx.accountId } }),
          prisma.message.count({ where: { conversation: { account_id: ctx.accountId } } }),
          prisma.lead.count({ where: { account_id: ctx.accountId } }),
          prisma.messageTemplate.count({ where: { account_id: ctx.accountId } }),
          prisma.flow.count({ where: { account_id: ctx.accountId } }),
          prisma.automation.count({ where: { account_id: ctx.accountId } }),
          prisma.dataTable.count({ where: { account_id: ctx.accountId } }),
          prisma.aiKnowledgeItem.count({ where: { account_id: ctx.accountId } }),
        ])
      return {
        contacts,
        conversations,
        messages,
        enquiries: leads,
        message_templates: templates,
        chatbot_flows: flows,
        automations,
        data_tables: tables,
        knowledge_base_entries: knowledge,
      }
    },
  },

  enquiries_by_source: {
    declaration: {
      name: 'enquiries_by_source',
      description:
        'Counts enquiries (leads) grouped by where they came from — whatsapp, instagram, website, campaign, referral, manual. Returns each source with its count and percentage of the total.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { days_back: DAYS_BACK_PARAM },
      },
    },
    async run(args, ctx) {
      const since = sinceFrom(args)
      const grouped = await prisma.lead.groupBy({
        by: ['source'],
        where: { account_id: ctx.accountId, ...(since ? { created_at: { gte: since } } : {}) },
        _count: { _all: true },
      })
      return withPercentages(grouped.map((g) => ({ label: g.source, count: g._count._all })))
    },
  },

  enquiries_by_status: {
    declaration: {
      name: 'enquiries_by_status',
      description:
        'Counts enquiries (leads) grouped by their pipeline status — new, call_not_connected, visited, appointment_fixed, follow_up, closed. Use for "where are enquiries stuck" or conversion questions.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { days_back: DAYS_BACK_PARAM },
      },
    },
    async run(args, ctx) {
      const since = sinceFrom(args)
      const grouped = await prisma.lead.groupBy({
        by: ['status'],
        where: { account_id: ctx.accountId, ...(since ? { created_at: { gte: since } } : {}) },
        _count: { _all: true },
      })
      return withPercentages(grouped.map((g) => ({ label: g.status, count: g._count._all })))
    },
  },

  recent_enquiries: {
    declaration: {
      name: 'recent_enquiries',
      description:
        'A short list of the most recent enquiries with their title, source, status, priority score and date. Use when asked to show or list actual enquiries rather than counts.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          limit: { type: SchemaType.NUMBER, description: 'How many to return (max 20, default 10).' },
          status: { type: SchemaType.STRING, description: 'Optional. Only enquiries with this status.' },
        },
      },
    },
    async run(args, ctx) {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10))
      const status = typeof args.status === 'string' ? args.status : undefined
      const leads = await prisma.lead.findMany({
        where: { account_id: ctx.accountId, ...(status ? { status } : {}) },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: { title: true, source: true, status: true, score: true, district: true, created_at: true },
      })
      return leads.map((l) => ({
        title: l.title,
        source: l.source,
        status: l.status,
        priority: l.score,
        district: l.district,
        created: l.created_at.toISOString().slice(0, 10),
      }))
    },
  },

  conversation_stats: {
    declaration: {
      name: 'conversation_stats',
      description:
        'Conversation totals for the inbox: how many are open/pending/closed, how many are unassigned, and how many have unread messages. Use for workload and backlog questions.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { days_back: DAYS_BACK_PARAM },
      },
    },
    async run(args, ctx) {
      const since = sinceFrom(args)
      const base = { account_id: ctx.accountId, ...(since ? { created_at: { gte: since } } : {}) }
      const [byStatus, unassigned, withUnread, total] = await Promise.all([
        prisma.conversation.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
        prisma.conversation.count({ where: { ...base, assigned_agent_id: null } }),
        prisma.conversation.count({ where: { ...base, unread_count: { gt: 0 } } }),
        prisma.conversation.count({ where: base }),
      ])
      return {
        total,
        by_status: byStatus.map((g) => ({ status: g.status, count: g._count._all })),
        unassigned,
        with_unread_messages: withUnread,
      }
    },
  },

  message_volume: {
    declaration: {
      name: 'message_volume',
      description:
        'How many messages were sent and received, split by inbound (from customers) and outbound (from agents or the bot). Use for activity/volume questions.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { days_back: DAYS_BACK_PARAM },
      },
    },
    async run(args, ctx) {
      const since = sinceFrom(args)
      const where = {
        conversation: { account_id: ctx.accountId },
        ...(since ? { created_at: { gte: since } } : {}),
      }
      const grouped = await prisma.message.groupBy({
        by: ['sender_type'],
        where,
        _count: { _all: true },
      })
      const rows = grouped.map((g) => ({ label: g.sender_type, count: g._count._all }))
      return {
        ...withPercentages(rows),
        window: since ? `last ${args.days_back} days` : 'all time',
      }
    },
  },

  agent_workload: {
    declaration: {
      name: 'agent_workload',
      description:
        'How many conversations each team member currently has assigned, and how many are still open. Use for "who is handling what" or workload-balance questions.',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const grouped = await prisma.conversation.groupBy({
        by: ['assigned_agent_id'],
        where: { account_id: ctx.accountId, assigned_agent_id: { not: null } },
        _count: { _all: true },
      })
      const ids = grouped.map((g) => g.assigned_agent_id).filter((id): id is string => !!id)
      const profiles = await prisma.profile.findMany({
        where: { user_id: { in: ids } },
        select: { user_id: true, full_name: true },
      })
      const nameOf = new Map(profiles.map((p) => [p.user_id, p.full_name]))
      return grouped
        .map((g) => ({
          agent: nameOf.get(g.assigned_agent_id!) || 'Unknown',
          assigned_conversations: g._count._all,
        }))
        .sort((a, b) => b.assigned_conversations - a.assigned_conversations)
    },
  },

  contact_stats: {
    declaration: {
      name: 'contact_stats',
      description:
        'Contact totals: how many contacts exist, how many opted in or out of marketing, and how many were added recently.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { days_back: DAYS_BACK_PARAM },
      },
    },
    async run(args, ctx) {
      const since = sinceFrom(args)
      const [total, added, byOptIn] = await Promise.all([
        prisma.contact.count({ where: { account_id: ctx.accountId } }),
        since
          ? prisma.contact.count({ where: { account_id: ctx.accountId, created_at: { gte: since } } })
          : Promise.resolve(null),
        prisma.contact.groupBy({
          by: ['opt_in_status'],
          where: { account_id: ctx.accountId },
          _count: { _all: true },
        }),
      ])
      return {
        total_contacts: total,
        ...(added !== null ? { added_in_window: added } : {}),
        by_opt_in_status: byOptIn.map((g) => ({ status: g.opt_in_status, count: g._count._all })),
      }
    },
  },

  search_knowledge_base: {
    declaration: {
      name: 'search_knowledge_base',
      description:
        "Searches what the chatbot has been taught — the account's own knowledge base entries, including staff-only ones — and returns the most relevant ones. Use to answer 'what do we tell customers about X' or to check whether something has been trained at all.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING, description: 'What to look for.' },
        },
        required: ['query'],
      },
    },
    async run(args, ctx) {
      const query = String(args.query ?? '').trim()
      if (!query) return { matches: [], note: 'No search text was given.' }
      const config = await prisma.aiConfig.findUnique({
        where: { account_id: ctx.accountId },
        select: { id: true },
      })
      if (!config) return { matches: [], note: 'No AI configuration exists for this account.' }
      // 'all': the Admin side is exactly where staff-only entries
      // should be findable. The customer path never sees them.
      const { qaPairs, documents } = await loadKnowledge(config.id, 'all')
      // Keyword scoring only here: this runs inside a tool call that is
      // already inside a model turn, and paying an extra embedding round
      // trip mid-conversation to rank a handful of entries isn't worth
      // the added latency.
      const selected = await selectRelevantContext(query, qaPairs, documents, {
        maxQaPairs: 5,
        maxDocChunks: 3,
      })
      return {
        matches: [
          ...selected.qaPairs.map((p) => ({ type: 'Q&A', question: p.question, answer: p.answer })),
          ...selected.documentChunks.map((c) => ({ type: 'Document', source: c.title, text: c.text })),
        ],
        relevance: Number(selected.confidence.toFixed(2)),
      }
    },
  },

  list_data_tables: {
    declaration: {
      name: 'list_data_tables',
      description:
        "Lists the account's custom Data Store tables with their field names and record counts. Call this first to find out what custom data exists before reading any of it.",
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const tables = await prisma.dataTable.findMany({
        where: { account_id: ctx.accountId },
        orderBy: { sort_order: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          fields: { orderBy: { sort_order: 'asc' }, select: { label: true, field_type: true } },
          _count: { select: { records: true } },
        },
      })
      return tables.map((t) => ({
        table_id: t.id,
        name: t.name,
        description: t.description,
        record_count: t._count.records,
        fields: t.fields.filter((f) => f.field_type !== 'password').map((f) => f.label),
      }))
    },
  },

  read_data_table: {
    declaration: {
      name: 'read_data_table',
      description:
        'Reads records from one Data Store table by its table_id (get ids from list_data_tables first). Returns up to 50 records. Password-type fields are never returned.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          table_id: { type: SchemaType.STRING, description: 'The table_id from list_data_tables.' },
          limit: { type: SchemaType.NUMBER, description: 'How many records (max 50, default 20).' },
        },
        required: ['table_id'],
      },
    },
    async run(args, ctx) {
      const tableId = String(args.table_id ?? '')
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
      // Scoped by account_id as well as id — a table_id echoed back by
      // the model is untrusted input, and this is the check that makes
      // guessing another account's id useless rather than dangerous.
      const table = await prisma.dataTable.findFirst({
        where: { id: tableId, account_id: ctx.accountId },
        select: {
          name: true,
          fields: { orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true } },
        },
      })
      if (!table) return { error: 'No such table in this account.' }
      const fields = table.fields.filter((f) => f.field_type !== 'password')
      const records = await prisma.dataRecord.findMany({
        where: { table_id: tableId, account_id: ctx.accountId },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: { data: true },
      })
      return {
        table: table.name,
        records: records.map((r) => {
          const data = (r.data ?? {}) as Record<string, unknown>
          return Object.fromEntries(fields.map((f) => [f.label, data[f.field_key] ?? null]))
        }),
      }
    },
  },

  list_chatbots: {
    declaration: {
      name: 'list_chatbots',
      description:
        "Every chatbot and flow in this account: what it is called, what it is for, whether it is live, what triggers it, how many steps it has and how often it has run. Use this for 'what chatbots do we have', 'which bot handles X', or before describing one in detail.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          only_active: {
            type: SchemaType.BOOLEAN,
            description: 'Optional. True to list only published/active ones. Omit for everything including drafts.',
          },
        },
      },
    },
    async run(args, ctx) {
      const flows = await prisma.flow.findMany({
        where: {
          account_id: ctx.accountId,
          ...(args.only_active === true ? { status: { in: ['active', 'published'] } } : {}),
        },
        select: {
          id: true, name: true, description: true, flow_type: true, channel: true,
          status: true, trigger_type: true, trigger_config: true,
          execution_count: true, last_executed_at: true, updated_at: true,
          _count: { select: { nodes: true } },
        },
        orderBy: [{ status: 'asc' }, { execution_count: 'desc' }],
        take: 60,
      })

      if (flows.length === 0) {
        return { found: false, note: 'This account has no chatbots or flows yet.' }
      }

      return {
        found: true,
        total: flows.length,
        chatbots: flows.map((f) => ({
          id: f.id,
          name: f.name,
          purpose: f.description || 'No description was written for this one.',
          kind: f.flow_type === 'chatbot' ? 'chatbot' : 'flow',
          channel: f.channel,
          status: f.status,
          starts_when: describeTrigger(f.trigger_type, f.trigger_config),
          steps: f._count.nodes,
          times_run: f.execution_count,
          last_run: f.last_executed_at ? f.last_executed_at.toISOString().slice(0, 10) : 'never',
        })),
      }
    },
  },

  describe_chatbot: {
    declaration: {
      name: 'describe_chatbot',
      description:
        "Every step of one chatbot, in order, with what each step does and where it leads. Use this to explain how a bot works, to find why it does or does not do something, or to spot steps that lead nowhere. Get the id from list_chatbots first.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          chatbot_id: { type: SchemaType.STRING, description: 'The id from list_chatbots.' },
        },
        required: ['chatbot_id'],
      },
    },
    async run(args, ctx) {
      const id = typeof args.chatbot_id === 'string' ? args.chatbot_id : ''
      if (!id) return { error: 'A chatbot_id is required. Call list_chatbots first.' }

      const flow = await prisma.flow.findFirst({
        // account_id in the filter, not just the id: an id from another
        // account must not resolve even if one were guessed.
        where: { id, account_id: ctx.accountId },
        select: {
          name: true, description: true, flow_type: true, channel: true, status: true,
          trigger_type: true, trigger_config: true, entry_node_id: true, fallback_policy: true,
          nodes: {
            select: { node_key: true, node_type: true, config: true },
            orderBy: { created_at: 'asc' },
          },
        },
      })
      if (!flow) return { error: 'No chatbot with that id in this account.' }

      const steps = flow.nodes.map((n) => {
        const config = (n.config ?? {}) as Record<string, unknown>
        return {
          step: n.node_key,
          does: describeNode(n.node_type, config),
          type: n.node_type,
          leads_to: nextKeys(n.node_type, config),
        }
      })

      // entry_node_id stores a node_key, not a node id — the engine uses
      // it directly as current_node_key when it starts a run. Matching it
      // against ids reported every working bot as having no entry point,
      // which is alarming and wrong.
      const entryKey = flow.nodes.some((n) => n.node_key === flow.entry_node_id)
        ? flow.entry_node_id
        : null

      // A step nothing points at, and which is not the entry point, is
      // unreachable — the most common real fault in a hand-built bot and
      // invisible in a graph you have to scroll.
      const referenced = new Set(steps.flatMap((s) => s.leads_to))
      const unreachable = steps
        .filter((s) => s.step !== entryKey && s.type !== 'start' && !referenced.has(s.step))
        .map((s) => s.step)

      // 'link_chatbot' and 'send_to_number' finish this bot on purpose —
      // one hands over to another chatbot, the other messages elsewhere.
      // Reporting them as dead ends buries the real ones.
      const TERMINAL = ['end', 'handoff', 'link_chatbot']
      const deadEnds = steps
        .filter((s) => s.leads_to.length === 0 && !TERMINAL.includes(s.type))
        .map((s) => s.step)

      return {
        name: flow.name,
        purpose: flow.description || 'No description was written for this one.',
        kind: flow.flow_type === 'chatbot' ? 'chatbot' : 'flow',
        channel: flow.channel,
        status: flow.status,
        starts_when: describeTrigger(flow.trigger_type, flow.trigger_config),
        // A missing entry point is not cosmetic: the runner refuses to
        // start a flow without one, so this bot can never fire however
        // good its steps are.
        first_step: entryKey ?? 'NOT SET — the runner cannot start this bot at all until an entry step is chosen',
        when_the_reply_is_not_understood: flow.fallback_policy,
        steps,
        problems: {
          unreachable_steps: unreachable,
          steps_that_lead_nowhere: deadEnds,
        },
      }
    },
  },

  list_whatsapp_forms: {
    declaration: {
      name: 'list_whatsapp_forms',
      description:
        "The Meta WhatsApp Flows (the in-chat forms customers fill in) that this account's chatbots send, and which chatbot sends each one. Use this for questions about forms, in-chat applications or data collection screens.",
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      // Read from the send_flow steps rather than from Meta: this answers
      // "which forms do we actually use", and a form that exists in Meta
      // but is wired into nothing is not what is being asked about.
      const flows = await prisma.flow.findMany({
        where: { account_id: ctx.accountId },
        select: {
          name: true, status: true,
          nodes: { where: { node_type: 'send_flow' }, select: { node_key: true, config: true } },
        },
      })

      const forms: { form_id: string; sent_by: string; chatbot_status: string; step: string; button: string }[] = []
      for (const flow of flows) {
        for (const node of flow.nodes) {
          const config = (node.config ?? {}) as Record<string, unknown>
          const formId = typeof config.flow_id === 'string' ? config.flow_id : null
          if (!formId) continue
          forms.push({
            form_id: formId,
            sent_by: flow.name,
            chatbot_status: flow.status,
            step: node.node_key,
            button: typeof config.button_text === 'string' ? config.button_text : 'Open',
          })
        }
      }

      if (forms.length === 0) {
        return { found: false, note: 'No chatbot in this account sends a WhatsApp Flow form.' }
      }
      return { found: true, total: forms.length, forms }
    },
  },
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = Object.values(TOOLS).map((t) => t.declaration)

export const TOOL_NAMES = Object.keys(TOOLS)

/** Executes one model-requested tool call. An unknown name is reported
 *  back to the model as a plain error rather than thrown, so a
 *  hallucinated function name costs one wasted turn instead of failing
 *  the whole conversation. */
export async function runTool(name: string, args: ToolArgs, ctx: ToolContext): Promise<unknown> {
  const tool = TOOLS[name]
  if (!tool) return { error: `Unknown tool "${name}". Available: ${TOOL_NAMES.join(', ')}` }
  try {
    return await tool.run(args ?? {}, ctx)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'That lookup failed.' }
  }
}


/** Turns a trigger row into the sentence somebody would say out loud. */
function describeTrigger(triggerType: string, triggerConfig: unknown): string {
  const config = (triggerConfig ?? {}) as Record<string, unknown>
  const keywords = Array.isArray(config.keywords) ? (config.keywords as string[]) : []

  switch (triggerType) {
    case 'keyword':
      return keywords.length
        ? `a customer's message contains: ${keywords.join(', ')}`
        : 'a keyword match, but no keywords have been set — so it never starts'
    case 'welcome':
    case 'first_message':
      return 'a customer messages for the very first time'
    case 'any_message':
      return 'any inbound message'
    case 'manual':
      return 'an agent starts it by hand'
    case 'ad_referral':
      return 'a customer arrives from a click-to-WhatsApp advert'
    default:
      return keywords.length ? `${triggerType} (${keywords.join(', ')})` : triggerType
  }
}

/**
 * One plain sentence for one step.
 *
 * Written for somebody reading an explanation, not for a developer
 * reading a schema — "asks a question and waits for the answer" rather
 * than "collect_input". The model relays these almost verbatim, so the
 * wording here is what an owner ends up reading.
 */
function describeNode(nodeType: string, config: Record<string, unknown>): string {
  const text = (key: string, fallback = ''): string => {
    const value = config[key]
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
  }
  const preview = (value: string) => (value.length > 90 ? `${value.slice(0, 89)}…` : value)

  switch (nodeType) {
    case 'send_message':
    case 'send_text':
      return `sends: "${preview(text('text', '(no message written)'))}"`
    case 'send_media':
      return `sends a ${text('kind', 'file')}${text('caption') ? ` with the caption "${preview(text('caption'))}"` : ''}`
    case 'send_template':
      return `sends the approved template "${text('template_name', '(none chosen)')}"`
    case 'send_buttons':
      return `asks "${preview(text('body_text', text('text', '(no question)')))}" with tappable buttons`
    case 'send_list':
      return `offers a list of options: "${preview(text('body_text', '(no text)'))}"`
    case 'send_flow':
      return `opens a WhatsApp form (Flow ${text('flow_id', 'not chosen')}) behind the button "${text('button_text', 'Open')}"`
    case 'send_catalog':
      return 'shows the product catalog'
    case 'collect_input':
      return `asks "${preview(text('prompt_text', '(no question)'))}" and waits, saving the answer as ${text('save_to', 'an unnamed variable')}`
    case 'ai_reply':
      return 'hands the question to the AI assistant, which answers from the knowledge base'
    case 'condition':
      return 'splits the path depending on what the customer said or what is stored about them'
    case 'delay':
      return `waits ${String(config.duration ?? config.minutes ?? '?')} before carrying on`
    case 'set_tag':
      return `tags the contact: ${text('tag', '(no tag set)')}`
    case 'set_variable':
      return `stores a value as ${text('key', '(unnamed)')}`
    case 'crm_action':
      return `does something in the CRM: ${text('action', 'unspecified action')}`
    case 'save_to_table':
      return 'saves the collected answers into a Data Store table'
    case 'http_request':
      return `calls an outside system at ${text('url', '(no address set)')}`
    case 'handoff':
      return 'stops and hands the conversation to a person'
    case 'link_chatbot':
      return 'jumps into another chatbot'
    case 'send_to_number':
      return 'sends a message to a different number'
    case 'start':
      return 'the entry point — where the conversation begins'
    case 'end':
      return 'ends the conversation'
    default:
      return nodeType.replace(/_/g, ' ')
  }
}

/**
 * Every step this one can lead to.
 *
 * Walks the config rather than listing the key names that hold an
 * onward link, because that list was already wrong once: buttons keep
 * theirs in an array, but a call-to-action button keeps it in a plain
 * object under `cta_button`, and missing that reported a working branch
 * as a dead end *and* its target as unreachable — two false alarms from
 * one omission. Node configs differ per type and will keep growing, so
 * the convention is the thing to rely on: any `next_node_key` or `next`
 * string anywhere in the config is an edge.
 *
 * Depth-limited because a config is a shallow tree and an unbounded walk
 * over model-adjacent data is a liability rather than a feature.
 */
function nextKeys(_nodeType: string, config: Record<string, unknown>): string[] {
  const keys = new Set<string>()

  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1)
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'next_node_key' || key === 'next' || key.endsWith('_node_key')) && typeof child === 'string') {
        const trimmed = child.trim()
        if (trimmed) keys.add(trimmed)
        continue
      }
      walk(child, depth + 1)
    }
  }

  walk(config, 0)
  return [...keys]
}
