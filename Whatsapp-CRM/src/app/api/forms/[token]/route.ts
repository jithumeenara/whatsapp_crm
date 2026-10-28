import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { formState } from '@/lib/data-store/public-form'
import {
  FORM_TOKEN,
  checkRenderTicket,
  loadPublicForm,
  validateFormValues,
  verifyPersonalLink,
} from '@/lib/data-store/public-form-server'
import { afterRecordCreated } from '@/lib/data-store/record-events'
import { batchDuplicates, groupActive, isSensitiveQuestion, personNameKey, splitSubmission } from '@/lib/data-store/form-group'
import { sendFormConfirmations } from '@/lib/data-store/form-confirm'
import { randomUUID } from 'crypto'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'

/**
 * A stranger submitting a table's public form. No login — the proxy lets
 * /api/forms/ through — so this file exports POST and nothing else, and
 * every request is limited, size-capped and checked before a row exists.
 *
 * Answers are generic on purpose where detail would help an attacker
 * (a bad link and a switched-off form look the same) and specific where
 * it helps the person filling it in (which field is wrong).
 */

/** Per address: a family sharing one connection can register a few
 *  people; a script cannot register hundreds. */
const PER_IP = { limit: 10, windowMs: 10 * 60_000 }
/** Per form, from everywhere: a ceiling on what a distributed flood can
 *  put into one table in an hour. */
const PER_FORM = { limit: 300, windowMs: 60 * 60_000 }
const MAX_BODY_BYTES = 64 * 1024
/** Rows, not requests: a group form can carry many people in one. Per
 *  address, and per form from everywhere. */
const ROWS_PER_IP = { limit: 60, windowMs: 10 * 60_000 }
const ROWS_PER_FORM = { limit: 600, windowMs: 60 * 60_000 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Uses `n` of a limit; false once it runs out. */
function takeRows(key: string, n: number, limit: { limit: number; windowMs: number }): boolean {
  for (let i = 0; i < n; i++) if (!checkRateLimit(key, limit).success) return false
  return true
}

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!FORM_TOKEN.test(token)) return reply({ error: 'This form is not available.' }, 404)

  const ip = clientIpKey(req.headers)
  const perIp = checkRateLimit(`web-form:${ip}`, PER_IP)
  if (!perIp.success) return rateLimitResponse(perIp)
  const perForm = checkRateLimit(`web-form-table:${token}`, PER_FORM)
  if (!perForm.success) return rateLimitResponse(perForm)

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return reply({ error: 'That is too much to send in one form.' }, 413)
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return reply({ error: 'The form could not be read.' }, 400)
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return reply({ error: 'That is too much to send in one form.' }, 413)
  }
  let body: { values?: unknown; people?: unknown; batch?: unknown; ticket?: unknown; consent?: unknown; website?: unknown; c?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return reply({ error: 'The form could not be read.' }, 400)
  }
  if (!body || typeof body !== 'object') return reply({ error: 'The form could not be read.' }, 400)

  try {
    await ensureDataStoreColumns().catch(() => {})
    const form = await loadPublicForm(token)
    if (!form) return reply({ error: 'This form is not available.' }, 404)

    // The business's own words, or null — the page then thanks them in
    // whichever language they are reading it in.
    const success = form.config.success_message ?? null
    const group = groupActive(form.config.group) ? form.config.group : null

    // A group sent again because its answer never arrived: already saved,
    // so it is answered before "full" or "already answered" could refuse
    // it. Sent again with different people, it is refused — those were
    // never saved, and saying "done" would be untrue.
    const batchId = group ? (typeof body.batch === 'string' && UUID.test(body.batch) ? body.batch.toLowerCase() : randomUUID()) : null
    if (batchId) {
      const saved = await prisma.dataRecord.count({ where: { table_id: form.tableId, account_id: form.accountId, batch_id: batchId } })
      if (saved > 0) {
        const sent = Array.isArray(body.people) ? body.people.length : -1
        if (sent !== saved) return reply({ error: 'This form was already sent with a different list. Reload the page to send more people.' }, 409)
        return reply({ ok: true, message: success, reference: batchId.replace(/-/g, '').slice(0, 8).toUpperCase(), count: saved })
      }
    }

    const state = formState(form.config, form.responses)
    if (!state.open) {
      return reply(
        {
          error:
            state.reason === 'full'
              ? 'This form has all the answers it needs.'
              : state.reason === 'closed'
                ? 'This form is closed.'
                : 'This form is not available.',
        },
        410,
      )
    }

    // The honeypot: a field no person can see. Answered as if it worked,
    // so a bot learns nothing, and nothing is saved.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return reply({ ok: true, message: success })
    }

    const ticket = checkRenderTicket(token, body.ticket)
    if (ticket === 'too_fast') return reply({ error: 'That was quick — please check your answers and send again.' }, 400)
    if (ticket !== 'ok') return reply({ error: 'This page has expired. Reload it and send again.' }, 400)

    // Only a signed personal link names the customer, and only one who
    // belongs to this account.
    const linked = verifyPersonalLink(form.tableId, typeof body.c === 'string' ? body.c : null)
    const contact = linked
      ? await prisma.contact.findFirst({
          where: { id: linked, account_id: form.accountId },
          select: { id: true, phone: true },
        })
      : null
    if (form.config.personal_only && !contact) {
      return reply({ error: 'This form only accepts answers from the link you were sent.' }, 403)
    }

    if (form.config.consent_text && body.consent !== true) {
      return reply({ error: 'Please tick the box to agree before sending.' }, 400)
    }

    const logic = { rules: form.config.rules, lookups: form.lookups }

    // One row per person. Without a group form that is one row, as before;
    // with one, each person's answers plus the answers asked once, each
    // checked in full — so a rule on a per-person question can still look
    // at the programme chosen above it.
    const rows: Array<Record<string, unknown>> = []
    if (group) {
      const split = splitSubmission(body.values, body.people, group)
      if (!split.ok) return reply({ error: split.problem, problems: [split.problem] }, 400)
      const problems: string[] = []
      split.people.forEach((person, i) => {
        const checked = validateFormValues(form.fields, { ...split.shared, ...person }, logic)
        if (checked.ok) rows.push(checked.values)
        else problems.push(...checked.problems.map((pr) => `${group.label} ${i + 1}: ${pr}`))
      })
      if (problems.length === 0) problems.push(...batchDuplicates(rows, form.fields, group))
      if (problems.length) {
        const unique = Array.from(new Set(problems)).slice(0, 20)
        return reply({ error: unique.join(' '), problems: unique }, 400)
      }
    } else {
      const checked = validateFormValues(form.fields, body.values, logic)
      if (!checked.ok) return reply({ error: checked.problems.join(' '), problems: checked.problems }, 400)
      rows.push(checked.values)
    }

    // "Most answers" counts people: a batch must fit in the places left.
    if (form.config.max_responses !== null && form.responses + rows.length > form.config.max_responses) {
      const left = Math.max(0, form.config.max_responses - form.responses)
      return reply({ error: left > 0 ? `Only ${left} place${left === 1 ? '' : 's'} left.` : 'This form has all the answers it needs.' }, 410)
    }

    if (form.config.one_per_person && contact) {
      const already = await prisma.dataRecord.findFirst({
        where: { table_id: form.tableId, account_id: form.accountId, contact_id: contact.id },
        select: { id: true },
      })
      if (already) return reply({ error: 'You have already answered this form. Thank you!' }, 409)
    }

    if (rows.length > 1 && (!takeRows(`web-form-rows:${ip}`, rows.length - 1, ROWS_PER_IP) || !takeRows(`web-form-rows-table:${token}`, rows.length - 1, ROWS_PER_FORM))) {
      return reply({ error: 'Too many people sent from here in a short time. Please try again later.' }, 429)
    }

    // A group is saved whole or not at all, and once (the unique batch index).
    let created
    try {
      created = await prisma.$transaction(
        rows.map((data, i) =>
          prisma.dataRecord.create({
            data: {
              table_id: form.tableId,
              account_id: form.accountId,
              contact_id: contact?.id ?? null,
              data: data as Prisma.InputJsonValue,
              source: 'web_form',
              ...(batchId ? { batch_id: batchId, batch_index: i + 1 } : {}),
            },
          }),
        ),
      )
    } catch (err) {
      // The same batch arriving twice at once: the other request saved it.
      if (batchId && (err as { code?: string })?.code === 'P2002') {
        return reply({ ok: true, message: success, reference: batchId.replace(/-/g, '').slice(0, 8).toUpperCase(), count: rows.length })
      }
      throw err
    }

    const nameKey = group ? personNameKey(form.fields, group.person_keys) : null
    const names = nameKey ? rows.map((r) => String(r[nameKey] ?? '').trim()).filter(Boolean) : []
    created.forEach((row, i) => {
      afterRecordCreated(
        { ...row, source: 'web_form' },
        group ? { alertOnce: batchId!, note: `${rows.length} ${group.label.toLowerCase()}${rows.length === 1 ? '' : 's'}${names.length ? `: ${names.slice(0, 10).join(', ')}${names.length > 10 ? '…' : ''}` : ''}` } : {},
      )
    })

    // Something to quote when they call the office. The first stretch of
    // the row's (or the batch's) own id: unique enough to find, meaningless outside.
    const reference = (batchId ?? created[0].id).replace(/-/g, '').slice(0, 8).toUpperCase()

    void sendFormConfirmations({
      accountId: form.accountId,
      tableId: form.tableId,
      business: form.businessName ?? '',
      reference,
      rows: rows.map((data) => ({ data })),
      nameKey,
      contactPhone: contact?.phone ?? null,
      submitter: form.config.confirm_submitter,
      person: group ? form.config.confirm_person : null,
      sender: ip,
      sensitive: new Set(form.fields.filter(isSensitiveQuestion).map((f) => f.key)),
    })

    return reply({ ok: true, message: success, reference, count: rows.length })
  } catch (err) {
    console.error('[web-form] submit failed:', err instanceof Error ? err.message : err)
    return reply({ error: 'Something went wrong. Please try again in a moment.' }, 500)
  }
}
