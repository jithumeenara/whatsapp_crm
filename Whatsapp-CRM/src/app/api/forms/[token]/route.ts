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
  let body: { values?: unknown; ticket?: unknown; consent?: unknown; website?: unknown; c?: unknown }
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

    // The business's own words, or null — the page then thanks them in
    // whichever language they are reading it in.
    const success = form.config.success_message ?? null

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
          select: { id: true },
        })
      : null
    if (form.config.personal_only && !contact) {
      return reply({ error: 'This form only accepts answers from the link you were sent.' }, 403)
    }

    if (form.config.consent_text && body.consent !== true) {
      return reply({ error: 'Please tick the box to agree before sending.' }, 400)
    }

    const checked = validateFormValues(form.fields, body.values)
    if (!checked.ok) return reply({ error: checked.problems.join(' '), problems: checked.problems }, 400)

    if (form.config.one_per_person && contact) {
      const already = await prisma.dataRecord.findFirst({
        where: { table_id: form.tableId, account_id: form.accountId, contact_id: contact.id },
        select: { id: true },
      })
      if (already) return reply({ error: 'You have already answered this form. Thank you!' }, 409)
    }

    const created = await prisma.dataRecord.create({
      data: {
        table_id: form.tableId,
        account_id: form.accountId,
        contact_id: contact?.id ?? null,
        data: checked.values as Prisma.InputJsonValue,
        source: 'web_form',
      },
    })
    afterRecordCreated({ ...created, source: 'web_form' })

    // Something to quote when they call the office. The first stretch
    // of the row's own id: unique enough to find, meaningless outside.
    const reference = created.id.replace(/-/g, '').slice(0, 8).toUpperCase()
    return reply({ ok: true, message: success, reference })
  } catch (err) {
    console.error('[web-form] submit failed:', err instanceof Error ? err.message : err)
    return reply({ error: 'Something went wrong. Please try again in a moment.' }, 500)
  }
}
