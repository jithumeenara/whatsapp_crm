/**
 * Is anybody at work right now — and what the customer is told when the
 * assistant passes them to a person.
 *
 * A handover used to say "let me connect you with a team member" at any
 * hour, and the assistant itself promised "our team will contact you
 * shortly" at ten at night, with nobody on shift until morning. Every
 * handover path (assistant, chatbot AI step, website "Talk to a person")
 * and the assistant's prompt now read the team's working hours from here,
 * on every channel.
 *
 * Hours are per member (Settings → Members → working hours); the team is
 * open while anybody who can reply is on shift. Nobody has hours set:
 * treated as open, exactly as the offers treat it.
 */

import { prisma } from '@/lib/db'
import { isOnShift, nextOpening, parseWorkingHours, summariseWeek } from '@/lib/agents/working-hours'
import { engineSendText } from '@/lib/flows/meta-send'

export const REPLY_CAPABLE = ['owner', 'supervisor', 'admin', 'agent']

export interface TeamHours {
  open: boolean
  /** "Mon–Sat 9:00 AM–5:00 PM", or null when nobody has hours set. */
  hours: string | null
  /** "tomorrow 9:00 AM" while closed, else null. */
  back: string | null
}

/** From the members' stored rotas. Pure, so it can be tested. */
export function teamHoursFrom(rotaValues: unknown[], now: Date = new Date()): TeamHours {
  const rotas = rotaValues.map((v) => parseWorkingHours(v)).filter((r) => r !== null)
  if (rotas.length === 0) return { open: true, hours: null, back: null }
  const open = rotas.some((r) => isOnShift(r, now))
  return { open, hours: summariseWeek(rotas[0]), back: open ? null : nextOpening(rotas[0], now) }
}

export async function teamHoursNow(accountId: string, now: Date = new Date()): Promise<TeamHours> {
  const profiles = await prisma.profile.findMany({
    where: { account_id: accountId, account_role: { in: REPLY_CAPABLE as never } },
    select: { working_hours: true },
  })
  return teamHoursFrom(profiles.map((p) => p.working_hours), now)
}

/** What the assistant is told about the team's hours, for its prompt. */
export function teamHoursPromptBlock(team: TeamHours): string {
  if (!team.hours) return ''
  if (team.open) {
    return [
      'TEAM AVAILABILITY:',
      `- The team is at work now (working hours: ${team.hours}). If the customer is passed to a person, someone can reply here soon.`,
    ].join('\n')
  }
  return [
    'TEAM AVAILABILITY:',
    `- Nobody from the team is working right now. Working hours: ${team.hours}.${team.back ? ` They are back ${team.back}.` : ''}`,
    '- Never say a person will reply, call or contact them now, shortly, soon or today. Say when the team is back instead.',
    '- If they want a person or a call, tell them the working hours and ask what time suits them. When they name a time inside working hours, record it with schedule_callback. If the time is outside working hours, say so and ask for one inside them.',
  ].join('\n')
}

export type Lang = 'ml' | 'en'

export function languageOf(text: string | null | undefined): Lang {
  return /\p{Script=Malayalam}/u.test(text ?? '') ? 'ml' : 'en'
}

/**
 * The line a customer reads when the team is closed. `withTimes`: call-back
 * time buttons follow it (WhatsApp); otherwise they are asked to type one.
 */
export function closedLine(lang: Lang, team: TeamHours, withTimes: boolean): string {
  if (lang === 'ml') {
    const hours = team.hours ? ` പ്രവൃത്തി സമയം: ${team.hours}.` : ''
    const ask = withTimes
      ? ' നിങ്ങളെ തിരികെ വിളിക്കാൻ സൗകര്യപ്രദമായ സമയം തിരഞ്ഞെടുക്കൂ:'
      : ' നിങ്ങളെ തിരികെ വിളിക്കാൻ സൗകര്യപ്രദമായ സമയം അറിയിക്കൂ, പ്രവൃത്തി സമയത്ത് ഞങ്ങൾ ബന്ധപ്പെടാം.'
    return `ഞങ്ങളുടെ ടീം ഇപ്പോൾ ലഭ്യമല്ല.${hours}${ask}`
  }
  const hours = team.hours ? ` Working hours: ${team.hours}.` : ''
  const back = team.back ? ` We are back ${team.back}.` : ''
  const ask = withTimes
    ? ' When would suit you for a call back?'
    : ' Tell us a time that suits you and we will get back to you during working hours.'
  return `Our team is not available right now.${hours}${back}${ask}`
}

/** Written on the thread when a closed team's customer is offered a call
 *  back; also the guard against offering twice. */
export const OUTSIDE_HOURS_NOTE = 'Outside working hours: the customer was offered a call back.'

const TOLD_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * Tells the customer they are being passed to a person: `openLine` while
 * the team is at work; outside working hours, that nobody is in, when they
 * are, and a call back (time buttons on WhatsApp, a typed time elsewhere).
 * Said once — not again for every message while the thread waits.
 *
 * Never throws: the handover itself (note, Pending, alert) is the caller's
 * and must not be lost to a failed message.
 */
export async function tellHandover(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  customerText: string
  openLine: string | null
  now?: Date
}): Promise<{ closed: boolean; whatsappMessageId?: string }> {
  const now = args.now ?? new Date()
  try {
    // Hours that cannot be read must not cost the customer their answer:
    // treated as "none set", so they hear the usual line.
    const team = await teamHoursNow(args.accountId, now).catch((err) => {
      console.error('[team-hours] could not read working hours:', err instanceof Error ? err.message : err)
      return { open: true, hours: null, back: null } satisfies TeamHours
    })
    const since = new Date(now.getTime() - TOLD_WINDOW_MS)

    if (team.open) {
      if (!args.openLine) return { closed: false }
      const said = await prisma.message.findFirst({
        where: { conversation_id: args.conversationId, content_text: args.openLine, created_at: { gte: since } },
        select: { id: true },
      })
      if (said) return { closed: false }
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        text: args.openLine,
      })
      return { closed: false, whatsappMessageId: whatsapp_message_id }
    }

    const told = await prisma.message.findFirst({
      where: { conversation_id: args.conversationId, sender_type: 'system', content_text: OUTSIDE_HOURS_NOTE, created_at: { gte: since } },
      select: { id: true },
    })
    if (told) return { closed: true }

    await prisma.message.create({
      data: { conversation_id: args.conversationId, sender_type: 'system', content_type: 'text', content_text: OUTSIDE_HOURS_NOTE, status: 'sent' },
    })

    const lang = languageOf(args.customerText)
    const conversation = await prisma.conversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { channel: true },
    })
    if ((conversation?.channel ?? 'whatsapp') === 'whatsapp') {
      const { askForCallbackTime } = await import('@/lib/agents/ask-callback')
      const asked = await askForCallbackTime({
        accountId: args.accountId,
        conversationId: args.conversationId,
        now,
        intro: closedLine(lang, team, true),
      })
      if (asked.asked) return { closed: true }
    }
    const { whatsapp_message_id } = await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: closedLine(lang, team, false),
    })
    return { closed: true, whatsappMessageId: whatsapp_message_id }
  } catch (err) {
    console.error('[team-hours] could not tell the customer about the handover:', err instanceof Error ? err.message : err)
    return { closed: false }
  }
}
