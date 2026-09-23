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
 * Not everything is read-only any more, and the ones that write are
 * held to a narrower rule than "the model asked for it".
 *
 * `schedule_callback` writes a reminder from a time the customer named,
 * and refuses one already past, one more than a year out, or an hour
 * that does not exist on the day in question.
 *
 * `contact_handed_over` writes a note and a task and changes no contact.
 * A number given in a message may be a digit short or missing its
 * country code, and replacing an organisation's only working number on
 * that basis loses the one that worked — see handover-contact.ts.
 *
 * The shape of the rule is the same in both: the model may record what
 * it was told, and a person decides what it means.
 */

import {
  SchemaType,
  type FunctionDeclaration,
} from '@google/generative-ai'
import { prisma } from '@/lib/db'
// One implementation of "a wall clock in this zone is this moment",
// shared with the callback slots the offer system sends.
import { zonedInstant } from '@/lib/agents/zoned-time'
import { anyOwner } from '@/lib/agents/ask-callback'
import { recordContactHandover } from './handover-contact'

export interface CustomerToolContext {
  accountId: string
  /** The contact this conversation belongs to. The only identity these
   *  tools will ever act on; never supplied by the model. */
  contactId: string
  /** Present only on the live WhatsApp path. Handing a conversation to
   *  a chatbot needs a conversation to hand over; the Test screen and
   *  the evaluation suite have none, so `start_chatbot` is simply not
   *  offered there rather than offered and failing. */
  conversationId?: string
  /** Sender-of-record for the bot's own messages, same as every other
   *  engine send. Required alongside conversationId. */
  userId?: string
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

  start_chatbot: {
    declaration: {
      name: 'start_chatbot',
      description:
        'Hand this conversation to one of the business\'s own guided chats, when the customer is asking for exactly what that chat is built to do. The guided chat has buttons, links, images and directions this assistant cannot send. Only use a chat named in your instructions, and only when the customer clearly wants what it does. Once it starts, it takes over the conversation — so do not use it for a question you can simply answer.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          bot_name: {
            type: SchemaType.STRING,
            description: 'The exact name of the guided chat, as listed in your instructions.',
          },
        },
        required: ['bot_name'],
      },
    },
    async run(args, ctx) {
      if (!ctx.conversationId || !ctx.userId) {
        return { started: false, note: 'Guided chats cannot be started here. Answer in your own words instead.' }
      }

      const wanted = typeof args.bot_name === 'string' ? args.bot_name.trim().toLowerCase() : ''
      if (!wanted) return { started: false, note: 'No chat name was given. Answer in your own words instead.' }

      // Only bots the account has explicitly allowed, and matched by
      // name rather than by id — the model is never handed an id, and
      // an id it invented would be an id it could act on.
      const allowed = await prisma.flow.findMany({
        where: { account_id: ctx.accountId, flow_type: 'chatbot', ai_can_start: true },
        select: { id: true, name: true },
      })
      const match =
        allowed.find((f) => f.name.trim().toLowerCase() === wanted) ??
        allowed.find((f) => f.name.trim().toLowerCase().includes(wanted)) ??
        null
      if (!match) {
        return {
          started: false,
          note: `There is no guided chat called "${args.bot_name}". Do not mention guided chats to the customer — just answer their question yourself.`,
        }
      }

      const { startChatbotForContact } = await import('@/lib/flows/engine')
      const result = await startChatbotForContact({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        flowId: match.id,
      })

      if (!result.started) {
        return {
          started: false,
          note:
            result.reason === 'already_in_a_chatbot'
              ? 'A guided chat is already running for this customer. Do not start another; answer in your own words.'
              : 'That guided chat could not be started. Answer the customer in your own words instead.',
        }
      }

      // The bot has already sent its own first message by the time this
      // returns. Anything the model writes now would arrive as a second,
      // competing message — so it is told to stop, and the code stops it
      // anyway (see customer-agent's handedToChatbot).
      return {
        started: true,
        note: `The "${match.name}" chat has taken over and has already messaged the customer. Say nothing further — your reply would arrive on top of it. Reply with an empty message.`,
      }
    },
  },

  schedule_callback: {
    declaration: {
      name: 'schedule_callback',
      description:
        `Write down a time the customer asked to be called back. Use this whenever they name a time — "tomorrow at 9", "this evening", "Monday morning" — including when you are also handing the conversation to a colleague. Give the date and time in the business's own time zone, which is stated in your instructions along with today's date. Do not use this for a vague "sometime" with no time in it, and do not invent a time the customer did not give.`,
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          date: {
            type: SchemaType.STRING,
            description: `The calendar date, as YYYY-MM-DD, in the business's time zone. Work it out from today's date, which is in your instructions.`,
          },
          time: {
            type: SchemaType.STRING,
            description: `24-hour clock time, as HH:MM. "9 in the morning" is 09:00; "evening" with no hour given is 17:00.`,
          },
          note: {
            type: SchemaType.STRING,
            description: 'What the customer actually said about it, in their own words, so whoever rings them knows what this is about.',
          },
        },
        required: ['date', 'time'],
      },
    },
    async run(args, ctx) {
      const date = typeof args.date === 'string' ? args.date : ''
      const time = typeof args.time === 'string' ? args.time : ''

      // The zone is read from the account, never from the model. A model
      // that offered its own would be guessing, and the guess would be
      // UTC — six hours out for this business, in the direction that
      // rings somebody before dawn.
      const profile = await prisma.companyProfile
        .findUnique({ where: { account_id: ctx.accountId }, select: { timezone: true } })
        .catch(() => null)
      const timezone = profile?.timezone?.trim() || 'Asia/Kolkata'

      const at = zonedInstant(timezone, date, time)
      if (!at) {
        return {
          scheduled: false,
          note: 'That date and time could not be read. Ask the customer to say the day and hour plainly, and do not tell them anything has been arranged.',
        }
      }

      // A time already gone is a misread, not a request. "Tomorrow" that
      // resolves to yesterday means the model got the date wrong, and
      // writing it would put a reminder in the Overdue list the moment
      // it was created.
      if (at.getTime() <= Date.now()) {
        return {
          scheduled: false,
          note: 'That time has already passed. Check what day the customer meant and try again; do not tell them it is arranged.',
        }
      }

      // A year out is the other direction of the same mistake — a model
      // that wrote 2027 for "next Monday".
      if (at.getTime() - Date.now() > 365 * 24 * 60 * 60_000) {
        return {
          scheduled: false,
          note: 'That is more than a year away, which is unlikely to be what was meant. Ask the customer to confirm the date.',
        }
      }

      const stated = typeof args.note === 'string' ? args.note.trim().slice(0, 300) : ''

      // The lead this contact already has, if any, so the reminder opens
      // the record somebody will work from rather than a bare contact.
      const lead = await prisma.lead
        .findFirst({
          where: { account_id: ctx.accountId, contact_id: ctx.contactId, status: { not: 'closed' } },
          orderBy: { created_at: 'desc' },
          select: { id: true, assigned_to: true, status: true },
        })
        .catch(() => null)

      const label = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(at)

      try {
        await prisma.followUp.create({
          data: {
            account_id: ctx.accountId,
            // Owned by whoever owns the lead, and otherwise by nobody —
            // the same rule the rest of the pool follows. An unowned
            // callback still surfaces: see /api/follow-ups/due, which
            // counts them for anyone who can act across the account.
            user_id: lead?.assigned_to ?? ctx.userId ?? (await anyOwner(ctx.accountId)),
            contact_id: ctx.contactId,
            lead_id: lead?.id ?? null,
            assigned_to: lead?.assigned_to ?? null,
            // The prefix advance-offers.ts already looks for when
            // deciding whether this customer has been asked about a
            // callback, so the two paths do not arrange one each.
            title: `Call back — ${label}`,
            note: stated
              ? `The customer asked for a call at this time. They said: "${stated}"`
              : 'The customer asked to be called back at this time.',
            due_at: at,
          },
        })
      } catch (err) {
        console.error('[schedule_callback] could not save:', err instanceof Error ? err.message : err)
        return {
          scheduled: false,
          note: 'It could not be saved. Tell the customer a colleague will be in touch, without promising a specific time.',
        }
      }

      // ── Put it where people look ─────────────────────────────────
      //
      // A reminder in the follow-ups table alone was invisible from the
      // Leads page. Its Follow-up tab lists leads whose *status* is
      // follow_up, which is what a follow-up scheduled by hand does to a
      // lead — and this did not, so a callback the assistant arranged
      // never appeared there and looked as though nothing had happened.
      //
      // Two cases, deliberately different:
      //
      //  - The lead is somebody's. It moves to Follow-up, exactly as if
      //    they had scheduled it themselves, and lands in their tab.
      //
      //  - Nobody has picked it up. It stays New, in the pool. Moving an
      //    unclaimed lead to Follow-up takes it out of New Pool, and an
      //    agent can only see leads that are theirs or in the pool — so
      //    it would vanish from every agent's screen at the moment a
      //    customer is waiting for a call. The request goes on its
      //    timeline instead, where whoever picks it up reads it first.
      if (lead) {
        const moveToFollowUp = Boolean(lead.assigned_to) && lead.status !== 'follow_up'
        await prisma
          .$transaction([
            ...(moveToFollowUp
              ? [prisma.lead.update({ where: { id: lead.id }, data: { status: 'follow_up' } })]
              : []),
            prisma.leadActivity.create({
              data: {
                account_id: ctx.accountId,
                lead_id: lead.id,
                contact_id: ctx.contactId,
                // Nobody: the assistant did this. A user_id here would
                // count as that agent's call on the performance screen.
                user_id: null,
                type: moveToFollowUp ? 'stage_change' : 'follow_up',
                title: `Customer asked for a call back — ${label}`,
                description: stated ? `They said: "${stated}"` : 'Arranged by the assistant from the conversation.',
                metadata: moveToFollowUp
                  ? { previous_status: lead.status, new_status: 'follow_up', by: 'assistant' }
                  : { due_at: at.toISOString(), by: 'assistant' },
              },
            }),
          ])
          .catch((err) =>
            console.error('[schedule_callback] lead not updated:', err instanceof Error ? err.message : err),
          )

        const { emitToAccount } = await import('@/lib/socket')
        emitToAccount(ctx.accountId, 'lead', {
          eventType: 'UPDATE',
          new: { id: lead.id, assigned_to: lead.assigned_to, status: moveToFollowUp ? 'follow_up' : lead.status },
        })
      }

      return {
        scheduled: true,
        when: label,
        note: `Recorded for ${label}. Confirm that time back to the customer in their own language, briefly.`,
      }
    },
  },

  contact_handed_over: {
    declaration: {
      name: 'contact_handed_over',
      description:
        `Record that this person no longer holds the post we have them down for, and has given somebody else's number instead. Use it when they say they have retired, left, been transferred, or that somebody else now handles this — and they give a number to use. Do not use it when they simply give an extra number for themselves, and do not use it without a number.`,
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          new_phone: {
            type: SchemaType.STRING,
            description: 'The number they gave, exactly as they wrote it, including any country code.',
          },
          new_name: {
            type: SchemaType.STRING,
            description: 'The name of the person taking over, if they said one. Leave out if they did not.',
          },
          said: {
            type: SchemaType.STRING,
            description: 'What they said about it, in their own words.',
          },
        },
        required: ['new_phone'],
      },
    },
    async run(args, ctx) {
      const phone = typeof args.new_phone === 'string' ? args.new_phone : ''
      if (!phone.trim()) {
        return {
          recorded: false,
          note: 'No number was given. Ask them for the number of the person who has taken over.',
        }
      }
      return recordContactHandover({
        accountId: ctx.accountId,
        fromContactId: ctx.contactId,
        newPhone: phone,
        newName: typeof args.new_name === 'string' ? args.new_name : null,
        said: typeof args.said === 'string' ? args.said : null,
        userId: ctx.userId ?? null,
      })
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

/** Tools that need a real conversation to act on, and are withheld
 *  where there isn't one — the Test screen, the evaluation suite. A
 *  declared tool that always fails teaches the model to distrust the
 *  ones that work. */
const NEEDS_CONVERSATION = new Set(['start_chatbot'])

/**
 * What this particular context may actually call.
 *
 * Built per turn rather than fixed, because the answer genuinely
 * differs: the same assistant on the same account can hand a live
 * WhatsApp thread to a chatbot and cannot hand a preview to anything.
 */
export function customerToolDeclarations(ctx: CustomerToolContext): FunctionDeclaration[] {
  const live = Boolean(ctx.conversationId && ctx.userId)
  return Object.entries(ALL_TOOLS)
    .filter(([name]) => live || !NEEDS_CONVERSATION.has(name))
    .map(([, t]) => t.declaration)
}

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
  '',
  'CALL BACKS:',
  // A tool nobody is told when to use is a tool that does not get used.
  // The failure this fixes: a customer wrote "can you arrange a call
  // back for me tomorrow at 9 in the morning", the conversation was
  // handed to a person, and no reminder was created anywhere — the
  // agent had to notice the message and type it in by hand.
  '- If the customer names a time they want to be called — "tomorrow at 9", "this evening", "Monday morning" — record it with schedule_callback. Do this even when you are also passing the conversation to a colleague; the two are not alternatives.',
  // Confirming a time nobody wrote down is worse than not offering one.
  // The tool reports whether it saved, and that is what to go on.
  '- Only tell them a time is arranged after the tool says it was. If it reports a failure, say a colleague will be in touch and do not name a time.',
  '- Do not invent a time. If they ask to be called but name none, say somebody will call and leave it there.',
  '',
  'WHEN THE PERSON HAS CHANGED:',
  // The case this is for: these records hold a society's secretary by
  // their personal number, and secretaries retire. The person who
  // answers says so and gives the new one's number — and until now
  // nothing captured it, so the next campaign rang the same retired
  // person again. Worse, the assistant read "I am retired from service"
  // as a topic and offered them staff training.
  '- If they say they have retired, left, moved on, or that somebody else now holds the post — and they give a number — record it with contact_handed_over.',
  '- Never tell them our records have been updated. They have not been: a colleague rings the new number first, because a number typed into a message can be a digit short.',
  '- Do not offer them anything. Somebody who has just said they no longer hold the post is not a person to ask about courses or programmes. Thank them, and say somebody will contact the new person.',
].join('\n')

/**
 * The tool instruction for one account, built when it is asked for.
 *
 * The registration half is appended only when that account has
 * actually opened a form. A business that takes no registrations
 * should not have its assistant carrying instructions on how to take
 * one — that is an invitation to offer something which does not exist.
 */
/**
 * What to say on a channel that has no tools at all.
 *
 * A live voice session — the browser console and a WhatsApp call alike —
 * is a system prompt handed to Gemini and nothing else. No function
 * declarations are sent, so no lookup can happen and no registration can
 * be saved. It was being given the text-channel instruction anyway:
 * "look it up", "never answer from memory", and lately "you can register
 * this customer yourself, right now". On a phone call none of that is
 * true, and a model told to look something up it cannot reach either
 * invents the answer or stalls waiting for a result that never comes.
 *
 * So the spoken channels are told the truth about themselves.
 */
export const VOICE_NO_TOOLS_INSTRUCTION = [
  'WHAT YOU CANNOT DO ON THIS CALL:',
  '- You cannot look up their records, check an application, or take a registration while you are speaking. You have no access to those here.',
  '- So do not say you are checking, looking it up, or one moment. Nothing is being checked.',
  '- If they ask about their own registration, application or order, say plainly that you cannot see it on a call, and offer to have a colleague check and message them on WhatsApp.',
  '- If they want to register, tell them you will send the form on WhatsApp, or that a colleague will call them back. Do not collect their details by voice as though you were saving them, because you are not.',
  '- Everything you were told about this business above is still yours to answer from. This is about records and actions, not knowledge.',
].join('\n')

/**
 * The guided chats this account has allowed the assistant to start, and
 * what each one is for.
 *
 * The purpose comes from the knowledge entry the bot was connected
 * through, because that is where somebody already wrote it down. A bot
 * with no purpose recorded still gets listed by name — a name like
 * "Location Guide" carries most of it.
 */
async function startableChatbots(accountId: string): Promise<Array<{ name: string; purpose: string | null }>> {
  const flows = await prisma.flow.findMany({
    where: { account_id: accountId, flow_type: 'chatbot', ai_can_start: true, status: 'active' },
    select: { id: true, name: true, description: true },
  })
  if (flows.length === 0) return []

  const entries = await prisma.aiKnowledgeItem.findMany({
    where: { account_id: accountId, kind: 'chatbot', source_ref: { in: flows.map((f) => f.id) } },
    select: { source_ref: true, description: true },
  })
  const purposeById = new Map(entries.map((e) => [e.source_ref, e.description]))

  return flows.map((f) => ({
    name: f.name,
    purpose: purposeById.get(f.id)?.trim() || f.description?.trim() || null,
  }))
}

export async function buildCustomerToolInstruction(accountId: string): Promise<string> {
  const [forms, bots] = await Promise.all([
    listRegistrationForms(accountId).catch(() => []),
    startableChatbots(accountId).catch(() => []),
  ])

  const botBlock =
    bots.length > 0
      ? [
          '',
          'GUIDED CHATS YOU CAN HAND OVER TO:',
          ...bots.map((b) => `- "${b.name}"${b.purpose ? ` — ${b.purpose}` : ''}`),
          '- Use start_chatbot only when the customer wants exactly what one of these does, and it would give them something you cannot: buttons, a map, a form, images.',
          '- It takes over the conversation. Never start one for a question you can answer in a sentence.',
          '- After starting one, send nothing. It has already messaged them.',
        ].join('\n')
      : ''

  if (forms.length === 0) return CUSTOMER_TOOL_INSTRUCTION + botBlock

  // Named, and said last.
  //
  // Escalation topics are written into the prompt above this, and they
  // say "don't try to answer it yourself". An account that listed
  // "registration" back when the assistant genuinely could not take one
  // has an instruction that now actively blocks the thing it was just
  // given the ability to do — the customer says "I want to register for
  // this" and gets handed to a colleague who is not there. Naming the
  // forms and placing this last is what settles the conflict: the model
  // weights its final instruction most, and a concrete "you can do X
  // yourself" beats an abstract "hand X over".
  const names = forms.map((f) => f.name).join(', ')
  return [
    CUSTOMER_TOOL_INSTRUCTION,
    REGISTRATION_INSTRUCTION,
    [
      'THIS OVERRIDES ANY EARLIER INSTRUCTION TO HAND REGISTRATIONS OVER:',
      `- You can register this customer yourself, right now, for: ${names}.`,
      '- If an earlier instruction told you a colleague handles registration, it was written before you could do it and no longer applies. Take the registration.',
      '- Do not ask for a human, and do not emit a handoff action, for anything these tools can do. Hand over only if they ask for a person, or if a save keeps failing after you have tried.',
    ].join('\n'),
  ].join('\n\n') + botBlock
}
