/**
 * What an AI assistant is allowed to ask this CRM.
 *
 * Every tool here reads. Nothing writes, nothing sends, nothing deletes.
 * That is a deliberate first position rather than an oversight: an
 * assistant that can message a customer or change a lead is a different
 * risk to one that can look things up, and the second is useful enough on
 * its own to be worth shipping before anyone argues about the first.
 *
 * Every query is scoped to the account the API key belongs to, in the
 * query itself. There is no code path here that takes an account id from
 * the caller.
 */

import { prisma } from '@/lib/db'
import { loadQualitySummary, loadUnansweredQuestions } from '@/lib/ai/quality'
import { loadKnowledge } from '@/lib/ai/knowledge-store'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>, accountId: string) => Promise<unknown>
}

/** Caps every list. An assistant asking for "all contacts" gets a page,
 *  not a download of the customer database into a model's context. */
const MAX_LIMIT = 50

function limitOf(args: Record<string, unknown>, fallback = 20): number {
  const n = Number(args.limit)
  return Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(n))) : fallback
}

function daysOf(args: Record<string, unknown>, fallback = 30): number {
  const n = Number(args.days)
  return Number.isFinite(n) ? Math.min(365, Math.max(1, Math.floor(n))) : fallback
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'search_contacts',
    description:
      'Find customers by name, phone number or email. Returns the matching ' +
      'contacts with their tags and when they were added.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, phone or email to search for.' },
        limit: { type: 'number', description: `Max results (default 20, cap ${MAX_LIMIT}).` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run(args, accountId) {
      const query = String(args.query ?? '').trim()
      if (!query) return { contacts: [] }
      const contacts = await prisma.contact.findMany({
        where: {
          account_id: accountId,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { created_at: 'desc' },
        take: limitOf(args),
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          company: true,
          created_at: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      })
      return {
        contacts: contacts.map((c) => ({
          ...c,
          tags: c.tags.map((t) => t.tag.name),
        })),
      }
    },
  },

  {
    name: 'get_contact',
    description:
      "One customer's full record: their details, tags, leads, and the last " +
      'few messages exchanged with them.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'The contact id.' },
        message_limit: { type: 'number', description: 'How many recent messages (default 10).' },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
    async run(args, accountId) {
      const contactId = String(args.contact_id ?? '')
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, account_id: accountId },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          company: true,
          created_at: true,
          tags: { select: { tag: { select: { name: true } } } },
          leads: {
            select: { id: true, status: true, source: true, created_at: true },
            orderBy: { created_at: 'desc' },
            take: 5,
          },
        },
      })
      if (!contact) return { error: 'No such contact in this account.' }

      const messages = await prisma.message.findMany({
        where: { conversation: { contact_id: contact.id, account_id: accountId } },
        orderBy: { created_at: 'desc' },
        take: Math.min(MAX_LIMIT, Math.max(1, Number(args.message_limit) || 10)),
        select: { sender_type: true, content_text: true, created_at: true },
      })

      return {
        contact: { ...contact, tags: contact.tags.map((t) => t.tag.name) },
        recent_messages: messages.reverse(),
      }
    },
  },

  {
    name: 'list_leads',
    description:
      'Leads from the last N days, newest first. Optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How far back to look (default 30).' },
        status: { type: 'string', description: 'Only leads in this status.' },
        limit: { type: 'number', description: `Max results (default 20, cap ${MAX_LIMIT}).` },
      },
      additionalProperties: false,
    },
    async run(args, accountId) {
      const since = new Date(Date.now() - daysOf(args) * 86_400_000)
      const status = typeof args.status === 'string' ? args.status.trim() : ''
      const leads = await prisma.lead.findMany({
        where: {
          account_id: accountId,
          created_at: { gte: since },
          ...(status ? { status } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limitOf(args),
        select: {
          id: true,
          status: true,
          source: true,
          created_at: true,
          contact: { select: { id: true, name: true, phone: true } },
        },
      })
      return { leads, since }
    },
  },

  {
    name: 'list_conversations',
    description:
      'Recent conversations with their status and last message, newest first. ' +
      'Use get_contact for the full thread.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "open, pending or closed." },
        limit: { type: 'number', description: `Max results (default 20, cap ${MAX_LIMIT}).` },
      },
      additionalProperties: false,
    },
    async run(args, accountId) {
      const status = typeof args.status === 'string' ? args.status.trim() : ''
      const conversations = await prisma.conversation.findMany({
        where: { account_id: accountId, ...(status ? { status } : {}) },
        orderBy: { last_message_at: 'desc' },
        take: limitOf(args),
        select: {
          id: true,
          status: true,
          last_message_text: true,
          last_message_at: true,
          unread_count: true,
          contact: { select: { id: true, name: true, phone: true } },
        },
      })
      return { conversations }
    },
  },

  {
    name: 'search_knowledge',
    description:
      "What the business has told its assistant about itself — the Q&A pairs " +
      'and reference documents behind every automated reply.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for. Omit to list everything.' },
      },
      additionalProperties: false,
    },
    async run(args, accountId) {
      const aiConfig = await prisma.aiConfig.findUnique({
        where: { account_id: accountId },
        select: { id: true },
      })
      if (!aiConfig) return { qa_pairs: [], documents: [] }

      // 'customer' rather than 'all': an assistant reached through an API
      // key is not the staff-facing assistant, and internal-only entries
      // are marked internal for a reason.
      const knowledge = await loadKnowledge(aiConfig.id, 'customer').catch(() => null)
      if (!knowledge) return { qa_pairs: [], documents: [] }

      const query = String(args.query ?? '').trim().toLowerCase()
      const matches = (text: string) => !query || text.toLowerCase().includes(query)

      return {
        qa_pairs: knowledge.qaPairs
          .filter((p) => matches(`${p.question} ${p.answer}`))
          .slice(0, MAX_LIMIT),
        documents: knowledge.documents
          .filter((d) => matches(`${d.title} ${d.content}`))
          .slice(0, 10)
          .map((d) => ({ title: d.title, excerpt: d.content.slice(0, 1_000) })),
      }
    },
  },

  {
    name: 'assistant_quality',
    description:
      'How the automated assistant has been performing: how many ' +
      'conversations it handled without a person, customer satisfaction, how ' +
      'often customers asked for a human, and the questions it has no answer for.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Window in days (default 30).' },
      },
      additionalProperties: false,
    },
    async run(args, accountId) {
      const days = daysOf(args)
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      const window = { accountId, from, to }
      const [summary, unanswered] = await Promise.all([
        loadQualitySummary(window),
        loadUnansweredQuestions(window, 20),
      ])
      return { days, summary, unanswered }
    },
  },
]

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]))
