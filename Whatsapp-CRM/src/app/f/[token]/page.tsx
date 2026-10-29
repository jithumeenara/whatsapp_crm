import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { formState } from '@/lib/data-store/public-form'
import { groupActive } from '@/lib/data-store/form-group'
import { headers as nextHeaders } from 'next/headers'
import { businessTimezone } from '@/lib/ai/human-date'
import { formLangList, liveCopy, pickLang } from '@/lib/data-store/form-i18n'
import {
  issueRenderTicket,
  loadPublicForm,
  publicFormSources,
  verifyPersonalLink,
} from '@/lib/data-store/public-form-server'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'
import { PublicFormView } from '@/components/data/public-form-view'

// Always rendered fresh: whether the form is open, and the ticket that
// dates this visit, are both about now.
export const dynamic = 'force-dynamic'

/** Measured here, on the server's clock, so the page never shows a
 *  countdown that disagrees with when the server stops taking answers. */
function msUntil(iso: string | null): number | null {
  if (!iso) return null
  return new Date(iso).getTime() - Date.now()
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  await ensureDataStoreColumns().catch(() => {})
  const form = await loadPublicForm(token).catch(() => null)
  // Absolute: a customer's tab shows the form and the business, not the
  // name of the CRM behind it.
  const name = form ? form.config.title || form.tableName : 'Form'
  return { title: { absolute: form?.businessName ? `${name} · ${form.businessName}` : name } }
}

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { token } = await params
  const query = await searchParams
  await ensureDataStoreColumns().catch(() => {})
  const form = await loadPublicForm(token)
  // A switched-off form and a wrong link look the same from outside.
  if (!form || !form.config.enabled) notFound()

  const state = formState(form.config, form.responses)
  const personal = typeof query.c === 'string' ? query.c : null
  const contactId = verifyPersonalLink(form.tableId, personal)
  const contact = contactId
    ? await prisma.contact.findFirst({
        where: { id: contactId, account_id: form.accountId },
        select: { name: true, phone: true },
      })
    : null

  // Answers carried in the link itself (?course=PSC), as Tally and
  // Typeform allow: a starting value the person can still change. A
  // question the form fills and locks is never taken from the link.
  const prefill: Record<string, string> = {}
  for (const f of form.fields) {
    const raw = query[f.key]
    if (typeof raw !== 'string' || !raw.trim()) continue
    if (form.config.rules[f.key]?.fill?.locked || f.type === 'section_header' || f.type === 'boolean') continue
    const value = raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
    if ((f.type === 'select' || f.type === 'radio') && f.options?.length) {
      const hit = f.options.find((o) => o.toLowerCase() === value.toLowerCase())
      if (hit) prefill[f.key] = hit
    } else {
      prefill[f.key] = value
    }
  }

  // Filled in for the person the business sent the link to, so they
  // confirm rather than retype. Only from a verified personal link.
  if (contact) {
    for (const f of form.fields) {
      if (f.type === 'phone' && contact.phone && !prefill[f.key]) prefill[f.key] = `+${contact.phone.replace(/\D/g, '')}`
      if (f.type === 'text' && /(^|_)(full_?)?name$/i.test(f.key) && contact.name) prefill[f.key] = contact.name
    }
  }

  // Each offered language, with only translations made from today's text.
  const sources = publicFormSources(form)
  const languages = formLangList(form.config.languages)
  const copy = Object.fromEntries(languages.map((l) => [l, liveCopy(form.config.copy, l, sources, form.config.languages.main)]))
  const headers = await nextHeaders()
  const startLang = pickLang(form.config.languages, [
    typeof query.lang === 'string' ? query.lang : null,
    ...(headers.get('accept-language') ?? '').split(',').map((p) => p.split(';')[0].trim()),
  ])

  const cp = form.config.confirm_page
  // Only needed for the time on the full confirmation.
  const timeZone = cp.enabled ? await businessTimezone(form.accountId) : 'UTC'

  return (
    <PublicFormView
      confirmPage={
        cp.enabled
          ? { title: cp.title, summaryKeys: cp.summary_keys, personKeys: cp.person_keys, showTime: cp.show_time, allowPrint: cp.allow_print }
          : null
      }
      timeZone={timeZone}
      languages={languages}
      startLang={startLang}
      copy={copy}
      token={token}
      ticket={issueRenderTicket(token)}
      personal={contact ? personal : null}
      greeting={contact?.name ?? null}
      businessName={form.businessName}
      brand={form.brand}
      rules={form.config.rules}
      lookups={form.lookups}
      successMessage={form.config.success_message}
      title={form.config.title || form.tableName}
      intro={form.config.intro}
      fields={form.fields}
      consentText={form.config.consent_text}
      closedReason={state.open ? null : state.reason}
      personalOnlyBlocked={form.config.personal_only && !contact}
      prefill={prefill}
      closesInMs={msUntil(form.config.closes_at)}
      spotsLeft={
        form.config.max_responses !== null ? Math.max(0, form.config.max_responses - form.responses) : null
      }
      allowAnother={!contact || !form.config.one_per_person}
      group={
        groupActive(form.config.group)
          ? {
              label: form.config.group.label,
              personKeys: form.config.group.person_keys.filter((k) => form.fields.some((f) => f.key === k)),
              min: form.config.group.min,
              max: form.config.group.max,
            }
          : null
      }
    />
  )
}
