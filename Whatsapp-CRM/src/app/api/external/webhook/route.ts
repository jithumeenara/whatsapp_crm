import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// POST /api/external/webhook?secret=<WEBHOOK_SECRET>
//
// Inbound receiver for external systems (HMS, LMS, billing software, etc.).
// Payload can carry contact and/or lead data. The secret token is the plain-text
// value stored as webhook_secret on the account's Settings row (or LeadSettings).
// Deduplication: if external_id is supplied, an existing contact/lead with that
// external_id is updated rather than duplicated.
//
// Example payload:
// {
//   "external_id": "hms-patient-1234",  // optional — used for dedup
//   "contact": {
//     "name": "Amal Kumar",
//     "phone": "+919876543210",
//     "email": "amal@example.com",
//     "company": "General Hospital"
//   },
//   "lead": {                            // optional
//     "title": "Inquiry from HMS",
//     "source": "hms",
//     "status": "new",
//     "score": "warm",
//     "notes": "Patient requested callback"
//   }
// }

export async function POST(req: NextRequest) {
  // Rate-limit by IP to prevent abuse from misconfigured external systems
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = checkRateLimit(`ext-webhook:${ip}`, RATE_LIMITS.apiWrite)
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 })
  }

  // Validate secret token
  const secret = req.nextUrl.searchParams.get('secret')?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Missing secret token.' }, { status: 401 })
  }

  // Look up which account owns this secret (raw SQL — webhook_secret is a new column
  // not yet reflected in the generated Prisma client until next prisma generate)
  const rows = await prisma.$queryRaw<{ account_id: string }[]>`
    SELECT account_id FROM lead_settings WHERE webhook_secret = ${secret} LIMIT 1
  `
  if (!rows.length) {
    return NextResponse.json({ error: 'Invalid secret token.' }, { status: 401 })
  }
  const accountId: string = rows[0].account_id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const externalId = typeof body.external_id === 'string' ? body.external_id.trim() : null
  const contactPayload = body.contact && typeof body.contact === 'object'
    ? (body.contact as Record<string, string>)
    : null
  const leadPayload = body.lead && typeof body.lead === 'object'
    ? (body.lead as Record<string, string>)
    : null

  if (!contactPayload && !leadPayload) {
    return NextResponse.json({ error: 'Payload must contain at least one of: contact, lead.' }, { status: 400 })
  }

  // Resolve the account owner's user_id — needed for user_id FK on Contact/Lead
  const systemProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: 'asc' },
    select: { user_id: true },
  })
  if (!systemProfile) {
    return NextResponse.json({ error: 'Account has no members.' }, { status: 403 })
  }
  const systemUserId = systemProfile.user_id

  let contactId: string | null = null

  // ── Upsert contact ──────────────────────────────────────────────────────────
  if (contactPayload) {
    const phone = typeof contactPayload.phone === 'string' ? contactPayload.phone.trim() : null
    const name = typeof contactPayload.name === 'string' ? contactPayload.name.trim() : null
    const email = typeof contactPayload.email === 'string' ? contactPayload.email.trim() : null
    const company = typeof contactPayload.company === 'string' ? contactPayload.company.trim() : null

    if (!phone && !name) {
      return NextResponse.json({ error: 'contact.phone or contact.name is required.' }, { status: 400 })
    }

    // Dedup: match by external_id first, then phone
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existing = externalId
      ? await prisma.contact.findFirst({ where: { account_id: accountId, external_id: externalId } as any })
      : null

    if (!existing && phone) {
      const normalized = normalizePhone(phone)
      existing = await prisma.contact.findFirst({
        where: { account_id: accountId, phone_normalized: normalized },
      })
    }

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(company && { company }),
          ...(externalId && { external_id: externalId }),
        } as any,
      })
      contactId = updated.id
    } else {
      const normalized = phone ? normalizePhone(phone) : null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await prisma.contact.create({
        data: {
          account_id: accountId,
          user_id: systemUserId,
          name: name ?? phone ?? 'Unknown',
          phone: phone ?? '',
          phone_normalized: normalized,
          email: email ?? null,
          company: company ?? null,
          external_id: externalId,
        } as any,
      })
      contactId = created.id
    }
  }

  // ── Upsert lead ─────────────────────────────────────────────────────────────
  let leadId: string | null = null
  if (leadPayload) {
    const title = typeof leadPayload.title === 'string' ? leadPayload.title.trim() : 'Webhook Lead'
    const source = typeof leadPayload.source === 'string' ? leadPayload.source.trim() : 'webhook'
    const status = typeof leadPayload.status === 'string' ? leadPayload.status.trim() : 'new'
    const score = typeof leadPayload.score === 'string' ? leadPayload.score.trim() : 'warm'
    const notes = typeof leadPayload.notes === 'string' ? leadPayload.notes.trim() : null

    // Dedup by external_id (stored as notes prefix with a marker, or via contact)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existingLead = externalId
      ? await prisma.lead.findFirst({ where: { account_id: accountId, external_id: externalId } as any })
      : null

    if (existingLead) {
      const updated = await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          title,
          source,
          status,
          score,
          notes: notes ?? existingLead.notes,
          ...(contactId && { contact_id: contactId }),
        },
      })
      leadId = updated.id
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await prisma.lead.create({
        data: {
          account_id: accountId,
          user_id: systemUserId,
          title,
          source,
          status,
          score,
          notes: notes ?? null,
          contact_id: contactId,
          external_id: externalId,
        } as any,
      })
      leadId = created.id

      await prisma.leadActivity.create({
        data: {
          account_id: accountId,
          lead_id: created.id,
          contact_id: contactId,
          user_id: systemUserId,
          type: 'created',
          title: 'Lead received via webhook',
          description: `Source: ${source}`,
        },
      })
    }
  }

  return NextResponse.json({ ok: true, contactId, leadId }, { status: 200 })
}
