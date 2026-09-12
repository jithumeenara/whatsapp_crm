import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'

/**
 * A health check for the thing everything else depends on: are inbox
 * contacts actually being saved and linked correctly?
 *
 * Every downstream feature — AI replies, lead pipelines, broadcasts,
 * the customer context the assistant now reads — assumes one contact row
 * per real person, correctly attached to their conversations. When that
 * assumption breaks it does so quietly: a duplicate contact splits
 * someone's history in half, an unnormalized phone number stops matching
 * on the next inbound message, a conversation points at a contact that
 * was merged away. None of it throws an error; it just makes the CRM
 * subtly wrong.
 *
 * This reports on exactly those conditions, read-only. It fixes nothing
 * on its own — a contact merge is a judgement call that already has its
 * own reviewed flow (POST /api/contacts/merge), and silently merging
 * people because two rows looked similar is precisely the kind of
 * automatic decision that should not happen to real customer data.
 */

export const dynamic = 'force-dynamic'

/** Bounded so the check stays fast on a large account; the counts above
 *  it are exact, only the listed examples are capped. */
const SCAN_LIMIT = 2000
const EXAMPLE_LIMIT = 10

export async function GET() {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const [total, merged, missingNormalized, optedIn, contacts, conversations] = await Promise.all([
    prisma.contact.count({ where: { account_id: accountId } }),
    prisma.contact.count({ where: { account_id: accountId, merged_into_contact_id: { not: null } } }),
    prisma.contact.count({
      where: { account_id: accountId, OR: [{ phone_normalized: null }, { phone_normalized: '' }] },
    }),
    prisma.contact.count({ where: { account_id: accountId, opt_in_status: 'opted_in' } }),
    prisma.contact.findMany({
      where: { account_id: accountId, merged_into_contact_id: null },
      orderBy: { created_at: 'desc' },
      take: SCAN_LIMIT,
      select: { id: true, name: true, phone: true, phone_normalized: true, created_at: true },
    }),
    prisma.conversation.findMany({
      where: { account_id: accountId },
      select: { id: true, contact_id: true, channel: true },
    }),
  ])

  // ── Duplicates: same person, two rows ──
  // Grouped on the last 8 digits rather than the raw string, which is how
  // findExistingContact matches on an inbound message — so this finds the
  // pairs that would actually confuse it, not merely rows that differ by
  // formatting.
  const bySuffix = new Map<string, typeof contacts>()
  for (const c of contacts) {
    const normalized = c.phone_normalized || normalizePhone(c.phone)
    if (!normalized) continue
    const key = normalized.length >= 8 ? normalized.slice(-8) : normalized
    const bucket = bySuffix.get(key)
    if (bucket) bucket.push(c)
    else bySuffix.set(key, [c])
  }

  const duplicateGroups: Array<{ phone: string; count: number; names: string[] }> = []
  for (const bucket of bySuffix.values()) {
    if (bucket.length < 2) continue
    // A shared 8-digit suffix is a candidate, not proof — confirm with
    // the same comparison the webhook uses before calling it a duplicate.
    const confirmed = bucket.filter((c) => phonesMatch(c.phone, bucket[0].phone))
    if (confirmed.length < 2) continue
    duplicateGroups.push({
      phone: bucket[0].phone,
      count: confirmed.length,
      names: confirmed.map((c) => c.name || '(no name)').slice(0, 4),
    })
  }

  // ── Conversations pointing nowhere useful ──
  const liveContactIds = new Set(contacts.map((c) => c.id))
  const orphanedConversations = conversations.filter(
    (c) => c.contact_id && !liveContactIds.has(c.contact_id),
  ).length

  const contactsWithConversation = new Set(conversations.map((c) => c.contact_id).filter(Boolean))
  const contactsWithoutConversation = contacts.filter((c) => !contactsWithConversation.has(c.id)).length

  const byChannel = conversations.reduce<Record<string, number>>((acc, c) => {
    acc[c.channel] = (acc[c.channel] ?? 0) + 1
    return acc
  }, {})

  const issues = duplicateGroups.length + missingNormalized
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    scanned: contacts.length,
    scan_capped: contacts.length >= SCAN_LIMIT,
    totals: {
      contacts: total,
      merged_away: merged,
      opted_in: optedIn,
      conversations: conversations.length,
    },
    by_channel: byChannel,
    findings: {
      duplicate_groups: duplicateGroups.length,
      duplicate_examples: duplicateGroups.slice(0, EXAMPLE_LIMIT),
      missing_normalized_phone: missingNormalized,
      contacts_without_conversation: contactsWithoutConversation,
      // Nonzero here means a conversation survived its contact being
      // hard-deleted, which the merge flow is specifically designed to
      // avoid (it soft-deletes) — so it points at direct DB edits.
      orphaned_conversations: orphanedConversations,
    },
    healthy: issues === 0 && orphanedConversations === 0,
  })
}

/**
 * Repairs the one finding that is safe to fix automatically: contacts
 * stored without a normalized phone.
 *
 * Deterministic and non-destructive — it derives phone_normalized from
 * the phone already on the row and writes nothing else. No contact is
 * created, merged, renamed or deleted. That matters because the
 * *other* finding, duplicate contacts, is deliberately not fixed here:
 * deciding two rows are the same person is a judgement call with a
 * reviewed flow of its own (POST /api/contacts/merge), and merging real
 * customers' histories on a similarity heuristic is not something to do
 * behind a button.
 *
 * Worth fixing because it compounds: a contact whose number was never
 * normalized may not match when that person messages again, so the
 * webhook creates a second contact — which is where duplicates come
 * from in the first place.
 */
export async function POST() {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const broken = await prisma.contact.findMany({
    where: { account_id: accountId, OR: [{ phone_normalized: null }, { phone_normalized: '' }] },
    select: { id: true, phone: true },
  })

  let repaired = 0
  let skipped = 0
  for (const contact of broken) {
    const normalized = normalizePhone(contact.phone)
    // A number that doesn't normalize at all (blank, or not a phone
    // number) is left exactly as it is and reported, rather than being
    // written as an empty string that would look repaired.
    if (!normalized) {
      skipped++
      continue
    }
    await prisma.contact.update({
      where: { id: contact.id },
      data: { phone_normalized: normalized },
    })
    repaired++
  }

  return NextResponse.json({
    repaired,
    skipped,
    message:
      skipped > 0
        ? `${repaired} contacts normalized. ${skipped} left alone — their stored phone isn't a usable number.`
        : `${repaired} contacts normalized.`,
  })
}
