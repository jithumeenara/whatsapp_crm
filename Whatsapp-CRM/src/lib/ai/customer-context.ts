/**
 * Who the person on the other end actually is, assembled for the reply
 * prompt.
 *
 * Without this the bot meets a stranger on every message: it can quote
 * the knowledge base perfectly and still ask someone their name for the
 * fourth time, or pitch a course to a lead who already enrolled. The CRM
 * knows all of it — the contact record, their lead and pipeline stage,
 * what happened on the last few follow-ups, which ad they came from, and
 * which channels they have talked on. This puts that in front of the
 * model in a compact, labelled form.
 *
 * Two rules govern what goes in:
 *
 *  1. Only facts about *this* contact. Never another customer's data,
 *    never account-wide figures — the customer-facing model has no
 *    business seeing either, and the Admin assistant is where aggregate
 *    questions belong.
 *  2. Nothing the customer couldn't be told. Internal scores and private
 *    notes are deliberately excluded: everything here is either
 *    something they told the business themselves or a plain fact about
 *    their own dealings with it, so the worst case if a model quotes it
 *    back is an awkward sentence, not a leak.
 */

import { prisma } from '@/lib/db'

/** Kept tight on purpose — this text is prepended to every reply's
 *  prompt, so it competes for the same budget as the knowledge the
 *  answer actually comes from. */
const MAX_ACTIVITIES = 5
const MAX_CHARS = 1800

export interface CustomerContextArgs {
  accountId: string
  contactId: string
  /** Excluded from the "also talks to you on" list, since the model
   *  already knows which channel it is replying on. */
  currentChannel?: string
}

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? `${label}: ${text}` : null
}

function daysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months === 1 ? 'about a month ago' : `about ${months} months ago`
}

export async function buildCustomerContext(args: CustomerContextArgs): Promise<string> {
  const { accountId, contactId, currentChannel } = args

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, account_id: accountId },
    select: {
      name: true,
      phone: true,
      email: true,
      company: true,
      detected_language: true,
      created_at: true,
      instagram_id: true,
      facebook_id: true,
      tags: { select: { tag: { select: { name: true } } } },
      custom_values: {
        select: { value: true, custom_field: { select: { field_name: true } } },
      },
    },
  })
  if (!contact) return ''

  const [leads, conversations] = await Promise.all([
    prisma.lead.findMany({
      where: { contact_id: contactId, account_id: accountId },
      orderBy: { created_at: 'desc' },
      take: 2,
      select: {
        title: true,
        status: true,
        source: true,
        district: true,
        created_at: true,
        activities: {
          orderBy: { created_at: 'desc' },
          take: MAX_ACTIVITIES,
          select: { type: true, description: true, created_at: true },
        },
        follow_ups: {
          where: { status: 'pending' },
          orderBy: { due_at: 'asc' },
          take: 1,
          select: { due_at: true, note: true },
        },
      },
    }),
    prisma.conversation.findMany({
      where: { contact_id: contactId, account_id: accountId },
      select: { channel: true, ctwa_ad_headline: true, created_at: true },
    }),
  ])

  const parts: string[] = []

  // ── Who they are ──
  const identity = [
    line('Name', contact.name),
    line('Company', contact.company),
    line('Email', contact.email),
    line('Writes in', contact.detected_language),
    line('Known to us since', daysAgo(contact.created_at)),
  ].filter(Boolean)
  if (identity.length) parts.push(`The customer you are talking to:\n${identity.join('\n')}`)

  const tags = contact.tags.map((t) => t.tag.name).filter(Boolean)
  if (tags.length) parts.push(`Tags on their record: ${tags.join(', ')}`)

  // Custom fields are whatever this business chose to track about people
  // — course interest, batch, referral source. Exactly the details that
  // make a reply feel informed.
  const custom = contact.custom_values
    .map((v) => line(v.custom_field.field_name, v.value))
    .filter(Boolean)
  if (custom.length) parts.push(`Details they have given you:\n${custom.join('\n')}`)

  // ── Where they are in the pipeline ──
  for (const lead of leads) {
    const leadLines = [
      line('Enquiry', lead.title),
      line('Current stage', lead.status?.replace(/_/g, ' ')),
      line('Came from', lead.source),
      line('District', lead.district),
      line('Raised', daysAgo(lead.created_at)),
    ].filter(Boolean)

    if (lead.follow_ups[0]) {
      const due = lead.follow_ups[0].due_at
      leadLines.push(`Follow-up scheduled: ${due.toISOString().slice(0, 10)}`)
    }

    if (lead.activities.length) {
      const history = lead.activities
        .map((a) => `- ${a.type.replace(/_/g, ' ')} (${daysAgo(a.created_at)})${a.description ? `: ${a.description}` : ''}`)
        .join('\n')
      leadLines.push(`Recent history:\n${history}`)
    }

    if (leadLines.length) parts.push(`Their enquiry with you:\n${leadLines.join('\n')}`)
  }

  // ── Cross-channel ──
  const otherChannels = [...new Set(conversations.map((c) => c.channel))].filter((c) => c !== currentChannel)
  if (otherChannels.length) {
    parts.push(`They have also messaged you on: ${otherChannels.join(', ')}. It is the same person.`)
  }

  const adHeadline = conversations.find((c) => c.ctwa_ad_headline)?.ctwa_ad_headline
  if (adHeadline) parts.push(`They first reached you from the ad: "${adHeadline}"`)

  if (parts.length === 0) return ''

  return [
    'CUSTOMER CONTEXT (facts from your CRM about this one person — use it to answer as someone who already knows them; never read this list out, and never mention other customers):',
    parts.join('\n\n'),
  ]
    .join('\n')
    .slice(0, MAX_CHARS)
}
