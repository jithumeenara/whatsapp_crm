/**
 * The tools the customer-facing assistant may call, on behalf of the one
 * person it is talking to.
 *
 * Why this exists: a knowledge base answers "what courses do you offer".
 * It cannot answer "has my application been processed", because that
 * answer is a row in the database, not a sentence in a document. Until
 * now the customer path had no function calling at all, so every such
 * question either got a generic non-answer or an invented one.
 *
 * The security model is narrower than the admin tools' and deliberately
 * so. Those are scoped to an account, because an owner asking about
 * their own CRM is entitled to aggregates across it. These are scoped to
 * **one contact**: every query below filters on `contactId` as well as
 * `accountId`, both taken from the resolved conversation and never from
 * model output. There is no tool that takes a contact id, a phone number
 * or a name as an argument — that is the whole defence. A model cannot
 * be talked into reading another customer's record when no tool it has
 * is capable of naming one.
 *
 * Everything is read-only. Nothing here creates, updates or deletes.
 */

import {
  SchemaType,
  type FunctionDeclaration,
} from '@google/generative-ai'
import { prisma } from '@/lib/db'

export interface CustomerToolContext {
  accountId: string
  /** The contact this conversation belongs to. The only identity these
   *  tools will ever act on; never supplied by the model. */
  contactId: string
}

type ToolArgs = Record<string, unknown>

interface CustomerToolImpl {
  declaration: FunctionDeclaration
  run: (args: ToolArgs, ctx: CustomerToolContext) => Promise<unknown>
}

/** Small caps everywhere. A customer asking about their enquiries has a
 *  handful, and an unbounded list would blow the prompt budget that the
 *  knowledge base needs. */
const MAX_ROWS = 5

/** Dates are rendered for a person to hear, not for a machine to parse —
 *  these answers get read aloud as often as they get read. */
function humanDate(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Internal status slugs are not customer-facing language. "call_not_
 *  connected" is an operations term; a customer hears "we tried to reach
 *  you". Anything unmapped falls back to a de-slugged version rather
 *  than leaking the raw value. */
const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'received, not yet reviewed',
  call_not_connected: 'we tried to call but could not reach you',
  visited: 'you have visited us',
  appointment_fixed: 'an appointment is scheduled',
  follow_up: 'our team is following up',
  closed: 'closed',
}

function leadStatusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

import { REGISTRATION_TOOLS, REGISTRATION_INSTRUCTION } from './registration-tools'
import { listRegistrationForms } from './registration'

const TOOLS: Record<string, CustomerToolImpl> = {
  my_enquiries: {
    declaration: {
      name: 'my_enquiries',
      description:
        "The status of this customer's own enquiries or applications with us. Use this whenever they ask about their application, enquiry, registration, admission status, or what is happening with their request. Returns nothing if they have never submitted one.",
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const leads = await prisma.lead.findMany({
        where: { account_id: ctx.accountId, contact_id: ctx.contactId },
        select: {
          title: true, status: true, source: true, district: true, place: true,
          created_at: true, updated_at: true, converted_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: MAX_ROWS,
      })
      if (leads.length === 0) {
        return { found: false, note: 'This customer has no enquiry on record. Do not invent one — offer to take their details.' }
      }
      return {
        found: true,
        enquiries: leads.map((l) => ({
          about: l.title,
          status: leadStatusLabel(l.status),
          submitted_on: humanDate(l.created_at),
          last_updated: humanDate(l.updated_at),
          location: l.place || l.district || null,
          came_from: l.source,
        })),
      }
    },
  },

  my_appointments: {
    declaration: {
      name: 'my_appointments',
      description:
        "This customer's own scheduled appointments, callbacks and follow-ups, with dates. Use this when they ask when someone will call them, when their appointment is, or whether anything is booked.",
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const followUps = await prisma.followUp.findMany({
        where: { account_id: ctx.accountId, contact_id: ctx.contactId, status: 'pending' },
        select: { title: true, due_at: true, note: true },
        orderBy: { due_at: 'asc' },
        take: MAX_ROWS,
      })
      if (followUps.length === 0) {
        return { found: false, note: 'Nothing is scheduled for this customer. Offer to arrange something rather than guessing a date.' }
      }
      return {
        found: true,
        scheduled: followUps.map((f) => ({
          what: f.title,
          when: humanDate(f.due_at),
          // The internal note is staff-facing and may say things like
          // "chase, went cold" — summarised away rather than quoted.
          has_note: Boolean(f.note),
        })),
      }
    },
  },

  my_orders: {
    declaration: {
      name: 'my_orders',
      description:
        "This customer's own orders placed through the catalog, with items and totals. Use this when they ask about an order they placed, what they bought, or how much it came to.",
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const orders = await prisma.order.findMany({
        where: { account_id: ctx.accountId, contact_id: ctx.contactId },
        select: { items: true, subtotal: true, currency: true, status: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: MAX_ROWS,
      })
      if (orders.length === 0) return { found: false, note: 'No orders on record for this customer.' }
      return {
        found: true,
        orders: orders.map((o) => ({
          placed_on: humanDate(o.created_at),
          status: o.status,
          total: o.subtotal ? `${o.currency ?? ''} ${o.subtotal.toString()}`.trim() : null,
          items: Array.isArray(o.items)
            ? (o.items as { name?: string; quantity?: number }[])
                .slice(0, 10)
                .map((i) => ({ name: i.name ?? 'item', quantity: i.quantity ?? 1 }))
            : [],
        })),
      }
    },
  },

  product_catalog: {
    declaration: {
      name: 'product_catalog',
      description:
        'Search the products, courses or services this business offers, with current prices and availability. Use this for "how much is X", "do you have X", or "what do you offer". Prices returned here are authoritative — never state a price that did not come from this tool or from the knowledge base.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          search: {
            type: SchemaType.STRING,
            description: 'Words from the product, course or service name. Omit to list what is available.',
          },
        },
      },
    },
    async run(args, ctx) {
      const search = typeof args.search === 'string' ? args.search.trim() : ''
      const products = await prisma.product.findMany({
        where: {
          account_id: ctx.accountId,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { description: { contains: search, mode: 'insensitive' as const } },
                  { category: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        select: { name: true, description: true, price: true, currency: true, availability: true, category: true },
        orderBy: { name: 'asc' },
        take: 8,
      })
      if (products.length === 0) {
        return {
          found: false,
          note: search
            ? `Nothing in the catalog matches "${search}". Say you will check with the team rather than guessing.`
            : 'The catalog is empty.',
        }
      }
      return {
        found: true,
        products: products.map((p) => ({
          name: p.name,
          category: p.category,
          price: p.price ? `${p.currency ?? 'INR'} ${p.price.toString()}` : 'price on request',
          availability: p.availability,
          description: p.description?.slice(0, 200) ?? null,
        })),
      }
    },
  },

  my_conversation_history: {
    declaration: {
      name: 'my_conversation_history',
      description:
        'What this customer has discussed with us before, across every channel — WhatsApp, Instagram, Messenger and the rest. Use this when they refer to an earlier conversation ("like I said before", "the person I spoke to") and you need to know what that was about.',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const conversations = await prisma.conversation.findMany({
        where: { account_id: ctx.accountId, contact_id: ctx.contactId },
        select: { channel: true, last_message_text: true, last_message_at: true, status: true },
        orderBy: { last_message_at: 'desc' },
        take: MAX_ROWS,
      })
      if (conversations.length === 0) return { found: false, note: 'No earlier conversations on record.' }
      return {
        found: true,
        conversations: conversations.map((c) => ({
          channel: c.channel ?? 'whatsapp',
          status: c.status,
          last_spoke: humanDate(c.last_message_at),
          about: c.last_message_text?.slice(0, 120) ?? null,
        })),
      }
    },
  },
}

/** Handed to the model as its callable surface. */
/**
 * Every tool, read-only and write alike.
 *
 * Merged here rather than kept behind a second runner, so
 * runCustomerTool stays the single place a tool call is dispatched.
 * Two dispatchers would eventually disagree about error handling, and
 * the one that writes is the wrong one to get that wrong.
 */
const ALL_TOOLS: Record<string, CustomerToolImpl> = { ...TOOLS, ...REGISTRATION_TOOLS }

export const CUSTOMER_TOOL_DECLARATIONS: FunctionDeclaration[] = Object.values(ALL_TOOLS).map(
  (t) => t.declaration,
)

export const CUSTOMER_TOOL_NAMES = Object.keys(ALL_TOOLS)

/**
 * Runs one tool by name.
 *
 * An unknown name returns an error object rather than throwing: the
 * model occasionally hallucinates a plausible-sounding tool, and the
 * correct response is to tell it that tool does not exist and let it try
 * again, not to fail the customer's message.
 */
export async function runCustomerTool(
  name: string,
  args: ToolArgs,
  ctx: CustomerToolContext,
): Promise<unknown> {
  const tool = ALL_TOOLS[name]
  if (!tool) return { error: `No such tool: ${name}. Available: ${CUSTOMER_TOOL_NAMES.join(', ')}` }
  try {
    return await tool.run(args, ctx)
  } catch (err) {
    // The customer must never see a database error. The model is told
    // the lookup failed so it can say so honestly and offer a handover.
    console.error(`[customer-tools] ${name} failed:`, err instanceof Error ? err.message : err)
    return { error: 'That lookup failed. Tell the customer you could not check right now and offer to have someone follow up.' }
  }
}

/** Appended to the prompt when tools are available, so the model knows
 *  these exist and — more importantly — when not to answer without
 *  them. Without this it confidently guesses order statuses. */
export const CUSTOMER_TOOL_INSTRUCTION = [
  'LOOKING THINGS UP:',
  'You can look up this specific customer\'s own records — their enquiries, appointments, orders, past conversations — and the product catalog.',
  '- If they ask about their own application, appointment, order or status, look it up. Never answer from memory or assumption.',
  '- If a lookup returns nothing, say so plainly and offer to take their details. Do not invent a record.',
  '- Never state a price, date or reference number that did not come from a lookup or from the knowledge you were given.',
  '- You can only see this one customer. If they ask about someone else, explain you can only discuss their own records.',
].join('\n')

/**
 * The tool instruction for one account, built when it is asked for.
 *
 * The registration half is appended only when that account has
 * actually opened a form. A business that takes no registrations
 * should not have its assistant carrying instructions on how to take
 * one — that is an invitation to offer something which does not exist.
 */
export async function buildCustomerToolInstruction(accountId: string): Promise<string> {
  const forms = await listRegistrationForms(accountId).catch(() => [])
  if (forms.length === 0) return CUSTOMER_TOOL_INSTRUCTION
  return `${CUSTOMER_TOOL_INSTRUCTION}\n\n${REGISTRATION_INSTRUCTION}`
}
