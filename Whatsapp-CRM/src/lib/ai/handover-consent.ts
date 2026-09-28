/**
 * Connecting a customer to a person — only when they want it, only when
 * somebody can take it, and only once somebody has.
 *
 * ── What was wrong ──────────────────────────────────────────────────
 *
 * A hand-over used to happen *to* the customer. The assistant decided it
 * could not answer, flipped the conversation to Pending and said "a
 * colleague will contact you" — at eleven at night as readily as at
 * eleven in the morning, and whether or not anybody would. One such
 * thread sat Pending for a day and a half with nobody assigned, and every
 * later question got the same promise.
 *
 * ── What happens now (when the account switches it on) ──────────────
 *
 *  1. The customer is asked first — "Shall I connect you to our team?",
 *     Yes / No buttons. Nothing is handed over until they say yes.
 *  2. On yes, staff on the alert numbers get the details straight away
 *     (handoff-alert.ts), whatever the hour.
 *  3. Inside working hours — somebody's shift covers now — it is offered
 *     to one agent at a time (lib/agents/run-offer.ts). The customer is
 *     told they are being connected; they are told who has them only
 *     when an agent accepts (notifyCustomerConnected).
 *  4. Outside working hours the customer is told so, with the hours, and
 *     asked when to be called back (lib/agents/ask-callback.ts) — a
 *     follow-up is scheduled either way.
 *  5. On no, the assistant carries on.
 *
 * Working hours are the team's own (each agent's rota); a team with none
 * set counts as always open, which is how the offers already behave.
 */

import { prisma } from '@/lib/db'
import { engineSendInteractiveButtons, engineSendText } from '@/lib/flows/meta-send'
import { isOnShift, parseWorkingHours, summariseWeek } from '@/lib/agents/working-hours'
import { sendHandoffAlert } from './handoff-alert'

export const ASK_MARKER = 'Offered to connect the customer to a person'
const AGREED_NOTE = 'The customer agreed to be connected to a person.'
const DECLINED_NOTE = 'The customer said no to being connected to a person.'

/** A tapped button older than this is not an answer to anything live. */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000
/** Asked this recently: do not ask again, the buttons are right there. */
const REASK_AFTER_MS = 10 * 60 * 1000

const REPLY_CAPABLE = ['owner', 'supervisor', 'admin', 'agent']

type Lang = 'ml' | 'en'

export function languageOf(text: string | null | undefined): Lang {
  return /\p{Script=Malayalam}/u.test(text ?? '') ? 'ml' : 'en'
}

const TEXT = {
  ml: {
    ask: 'ഈ കാര്യത്തിൽ ഞങ്ങളുടെ ടീമിലെ ഒരാൾക്ക് നിങ്ങളെ സഹായിക്കാനാകും. അവരുമായി ബന്ധിപ്പിക്കട്ടെ?',
    yes: 'അതെ',
    no: 'വേണ്ട',
    declined: 'ശരി. മറ്റെന്തെങ്കിലും അറിയാനുണ്ടെങ്കിൽ ചോദിക്കൂ.',
    connecting: 'നന്ദി. ഞങ്ങളുടെ ടീമിലെ ഒരാളുമായി ബന്ധിപ്പിക്കുന്നു — അൽപ്പസമയത്തിനുള്ളിൽ ഇവിടെ മറുപടി ലഭിക്കും.',
    willReply: 'നന്ദി. ഞങ്ങളുടെ ടീമിലെ ഒരാൾ ഇവിടെ ഉടൻ മറുപടി നൽകും.',
    closed: (hours: string | null) =>
      hours
        ? `ഞങ്ങളുടെ ടീം ഇപ്പോൾ ലഭ്യമല്ല. പ്രവൃത്തി സമയം: ${hours}. നിങ്ങളെ തിരികെ വിളിക്കാൻ സൗകര്യപ്രദമായ സമയം തിരഞ്ഞെടുക്കൂ:`
        : 'ഞങ്ങളുടെ ടീം ഇപ്പോൾ ലഭ്യമല്ല. നിങ്ങളെ തിരികെ വിളിക്കാൻ സൗകര്യപ്രദമായ സമയം തിരഞ്ഞെടുക്കൂ:',
    connected: (name: string) => `✅ ${name} ഇപ്പോൾ നിങ്ങളോടൊപ്പമുണ്ട്, ഇവിടെ മറുപടി നൽകും.`,
  },
  en: {
    ask: 'Someone from our team can help you with this. Shall I connect you to them?',
    yes: 'Yes, connect me',
    no: 'No, thanks',
    declined: 'No problem. Ask me anything else.',
    connecting: 'Thank you. Connecting you with our team — someone will reply here shortly.',
    willReply: 'Thank you. Someone from our team will reply here shortly.',
    closed: (hours: string | null) =>
      hours
        ? `Our team is not available right now. Working hours: ${hours}. When would suit you for a call back?`
        : 'Our team is not available right now. When would suit you for a call back?',
    connected: (name: string) => `✅ ${name} from our team is now with you and will reply here.`,
  },
} as const

// ── Answers ─────────────────────────────────────────────────────────

/** `ho_yes_<epoch ms>` / `ho_no_<epoch ms>`: the answer and when it was asked. */
export function consentButtonId(answer: 'yes' | 'no', askedAt: number): string {
  return `ho_${answer}_${askedAt}`
}

export function parseConsentButton(id: string | null | undefined, now = Date.now()): 'yes' | 'no' | null {
  const m = /^ho_(yes|no)_(\d{10,})$/.exec(id ?? '')
  if (!m) return null
  const at = Number(m[2])
  if (!Number.isFinite(at) || now - at > ANSWER_WINDOW_MS || at - now > 60_000) return null
  return m[1] as 'yes' | 'no'
}

const YES_WORDS = new Set([
  'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'yes please', 'ok please', 'please connect', 'connect', 'connect me',
  'yes connect me', 'athe', 'venam', 'sheri', 'shari', 'ok venam',
  'അതെ', 'ശരി', 'വേണം', 'ഓക്കെ', 'ഉവ്വ്', 'ബന്ധിപ്പിക്കൂ', 'അതെ വേണം', 'ശരി വേണം',
])
const NO_WORDS = new Set([
  'no', 'nope', 'not now', 'no thanks', 'no thank you', 'venda', 'vendaa', 'illa',
  'വേണ്ട', 'ഇല്ല', 'വേണ്ടാ', 'ഇപ്പോൾ വേണ്ട',
])

/** A typed yes or no, when the customer answers in words rather than a
 *  tap. The whole message must be the answer: "ok, what is the fee?"
 *  is a question, and "ആ പ്രോഗ്രാം" is not a yes. */
export function consentFromText(text: string | null | undefined): 'yes' | 'no' | null {
  const t = (text ?? '').toLowerCase().replace(/[.!,?🙏👍]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (NO_WORDS.has(t)) return 'no'
  if (YES_WORDS.has(t)) return 'yes'
  return null
}

// ── Working hours ───────────────────────────────────────────────────

export async function officeHours(accountId: string, now = new Date()): Promise<{ open: boolean; hours: string | null }> {
  const profiles = await prisma.profile.findMany({
    where: { account_id: accountId, account_role: { in: REPLY_CAPABLE as never } },
    select: { working_hours: true },
  })
  const rotas = profiles.map((p) => parseWorkingHours(p.working_hours)).filter((r) => r !== null)
  // Nobody has hours set: always open, exactly as the offers treat it.
  if (rotas.length === 0) return { open: true, hours: null }
  return { open: rotas.some((r) => isOnShift(r, now)), hours: summariseWeek(rotas[0]) }
}

// ── The pending question ────────────────────────────────────────────

interface PendingAsk {
  askedAt: Date
  reason: string
  note: string
}

/** The question this conversation is waiting on, if any: the newest ask
 *  note, not yet answered, inside the window. */
async function pendingAsk(conversationId: string, now = Date.now()): Promise<PendingAsk | null> {
  const notes = await prisma.message.findMany({
    where: {
      conversation_id: conversationId,
      sender_type: 'system',
      created_at: { gte: new Date(now - ANSWER_WINDOW_MS) },
    },
    orderBy: { created_at: 'desc' },
    take: 20,
    select: { content_text: true, created_at: true },
  })
  for (const n of notes) {
    const text = n.content_text ?? ''
    if (text.startsWith(AGREED_NOTE) || text.startsWith(DECLINED_NOTE)) return null
    if (text.startsWith(ASK_MARKER)) {
      const reason = /\(reason: ([a-z_]+)\)/.exec(text)?.[1] ?? 'model_requested'
      return { askedAt: n.created_at, reason, note: text }
    }
  }
  return null
}

async function note(conversationId: string, text: string): Promise<void> {
  await prisma.message.create({
    data: { conversation_id: conversationId, sender_type: 'system', content_type: 'text', content_text: text, status: 'sent' },
  })
}

async function lastCustomerMessage(conversationId: string, before?: Date): Promise<string> {
  const m = await prisma.message.findFirst({
    where: { conversation_id: conversationId, sender_type: 'customer', ...(before ? { created_at: { lte: before } } : {}) },
    orderBy: { created_at: 'desc' },
    select: { content_text: true },
  })
  return m?.content_text ?? ''
}

/**
 * Asks the customer whether they want a person. Writes the hand-over note
 * (so staff see why, even if the customer never answers) and sends Yes /
 * No buttons. Not repeated while an unanswered ask is still recent.
 */
export async function askForConsent(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  /** The reason key the alert filter uses (low_confidence, model_requested…). */
  reason: string
  /** The hand-over note staff would have got. */
  handoffNote: string
  customerMessage: string
}): Promise<'asked' | 'already_asked'> {
  const waiting = await pendingAsk(args.conversationId)
  if (waiting && Date.now() - waiting.askedAt.getTime() < REASK_AFTER_MS) return 'already_asked'

  const askedAt = Date.now()
  await note(args.conversationId, `${ASK_MARKER} (reason: ${args.reason}). Waiting for their answer.\n\n${args.handoffNote}`)

  const t = TEXT[languageOf(args.customerMessage)]
  await engineSendInteractiveButtons({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    bodyText: t.ask,
    buttons: [
      { id: consentButtonId('yes', askedAt), title: t.yes },
      { id: consentButtonId('no', askedAt), title: t.no },
    ],
  })
  return 'asked'
}

/**
 * The customer answered. Returns false when there is no question waiting
 * — the message is then handled as any other.
 */
export async function answerConsent(args: {
  accountId: string
  conversationId: string
  answer: 'yes' | 'no'
  now?: Date
}): Promise<boolean> {
  const now = args.now ?? new Date()
  const ask = await pendingAsk(args.conversationId, now.getTime())
  if (!ask) return false

  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, account_id: args.accountId },
    select: { contact_id: true, contact: { select: { name: true, phone: true } } },
  })
  if (!conversation?.contact_id) return false

  const account = await prisma.account.findUnique({ where: { id: args.accountId }, select: { owner_user_id: true } })
  const userId = account?.owner_user_id ?? ''
  const lang = languageOf(await lastCustomerMessage(args.conversationId))
  const t = TEXT[lang]
  const say = (text: string) =>
    engineSendText({ accountId: args.accountId, userId, conversationId: args.conversationId, contactId: conversation.contact_id!, text })

  if (args.answer === 'no') {
    await note(args.conversationId, DECLINED_NOTE)
    await say(t.declined).catch((err) => console.error('[handover] reply failed:', err))
    return true
  }

  // ── Yes ────────────────────────────────────────────────────────────
  await note(args.conversationId, AGREED_NOTE)
  const aiConfig = await prisma.aiConfig.findUnique({
    where: { account_id: args.accountId },
    select: { low_confidence_assign_to: true },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: {
      status: 'pending',
      ...(aiConfig?.low_confidence_assign_to ? { assigned_agent_id: aiConfig.low_confidence_assign_to } : {}),
    },
  })
  const { emitToAccount } = await import('@/lib/socket')
  emitToAccount(args.accountId, 'conversation', {
    eventType: 'UPDATE',
    new: { id: args.conversationId, status: 'pending' },
    old: {},
  })

  // Staff on the alert numbers hear now, whatever the hour — with who,
  // their number, what they asked, and why.
  void sendHandoffAlert({
    accountId: args.accountId,
    conversationId: args.conversationId,
    reason: ask.reason,
    customerMessage: await lastCustomerMessage(args.conversationId, ask.askedAt),
    contact: conversation.contact ? { name: conversation.contact.name, phone: conversation.contact.phone } : null,
  })

  const hours = await officeHours(args.accountId, now)
  if (!hours.open) {
    await note(args.conversationId, 'Outside working hours: the customer was offered a call back.')
    const { askForCallbackTime } = await import('@/lib/agents/ask-callback')
    const asked = await askForCallbackTime({ accountId: args.accountId, conversationId: args.conversationId, now, intro: t.closed(hours.hours) })
    if (!asked.asked) await say(t.closed(hours.hours)).catch(() => {})
    return true
  }

  // Inside hours: offered to one agent at a time; connected once one accepts.
  if (!aiConfig?.low_confidence_assign_to) {
    const { offerConversation } = await import('@/lib/agents/run-offer')
    const outcome = await offerConversation({ accountId: args.accountId, conversationId: args.conversationId, now })
    if (outcome.result === 'offered' && outcome.offerId && outcome.userId) {
      emitToAccount(args.accountId, 'offer', { offerId: outcome.offerId, userId: outcome.userId, conversationId: args.conversationId })
      await say(t.connecting).catch(() => {})
      return true
    }
    if (outcome.result === 'exhausted') {
      await note(args.conversationId, `Nobody could take it: ${outcome.reason}. The customer was offered a call back.`)
      const { askForCallbackTime } = await import('@/lib/agents/ask-callback')
      await askForCallbackTime({ accountId: args.accountId, conversationId: args.conversationId, now })
      return true
    }
  }
  await say(t.willReply).catch(() => {})
  return true
}

/** An agent accepted the offer: the customer hears who has them. */
export async function notifyCustomerConnected(args: {
  accountId: string
  conversationId: string
  agentUserId: string
}): Promise<void> {
  try {
    const [conversation, profile] = await Promise.all([
      prisma.conversation.findFirst({
        where: { id: args.conversationId, account_id: args.accountId },
        select: { contact_id: true },
      }),
      prisma.profile.findFirst({ where: { user_id: args.agentUserId, account_id: args.accountId }, select: { full_name: true } }),
    ])
    if (!conversation?.contact_id) return
    const name = profile?.full_name?.trim().split(/\s+/)[0] || (languageOf(await lastCustomerMessage(args.conversationId)) === 'ml' ? 'ടീമിലെ ഒരാൾ' : 'A colleague')
    const t = TEXT[languageOf(await lastCustomerMessage(args.conversationId))]
    await engineSendText({
      accountId: args.accountId,
      userId: args.agentUserId,
      conversationId: args.conversationId,
      contactId: conversation.contact_id,
      text: t.connected(name),
    })
  } catch (err) {
    console.error('[handover] could not tell the customer:', err instanceof Error ? err.message : err)
  }
}
