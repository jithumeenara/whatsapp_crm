/**
 * Google Forms — a form's responses arrive as Data Store records.
 *
 * Linking a form makes a table from it: one field per question, typed
 * from the question (choices become dropdowns or "pick several", a
 * paragraph becomes long text, a grid becomes one field per row), plus
 * the respondent's email when the form collects it and when they sent
 * it. From then on each new response is one record — on "Sync now" and
 * every 15 minutes — and a response comes in once however often the form
 * is read (its id is remembered).
 *
 * The records are a person's own details, so they carry the source
 * "google_form": alerts fire for them like a web form, and the customer
 * assistant never reads the table as knowledge (people-tables.ts).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { slugify } from '@/lib/data-store/slugify'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { ensureGoogleTables } from './store'

const API = 'https://forms.googleapis.com/v1'
const MAX_IMPORTED_IDS = 20_000

export class FormsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'FormsError'
  }
}

async function forms<T>(token: string, path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new FormsError(`Could not reach Google Forms: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
  if (res.ok) return (await res.json()) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Google Forms returned ${res.status}`
  if (/has not been used|is disabled/i.test(msg)) {
    throw new FormsError('The Google Forms API is not enabled in the Google Cloud project. APIs & Services → Library → Google Forms API → Enable.', 400)
  }
  if (res.status === 404 || res.status === 403) throw new FormsError('That form could not be opened. Choose it again in the Google window.', 400)
  throw new FormsError(msg, res.status >= 400 && res.status < 500 ? res.status : 502)
}

interface FormQuestion {
  questionId: string
  choiceQuestion?: { type?: 'RADIO' | 'CHECKBOX' | 'DROP_DOWN'; options?: Array<{ value?: string; isOther?: boolean }> }
  textQuestion?: { paragraph?: boolean }
  scaleQuestion?: unknown
  ratingQuestion?: unknown
  dateQuestion?: { includeTime?: boolean }
  timeQuestion?: unknown
  fileUploadQuestion?: unknown
  rowQuestion?: { title?: string }
}

export interface GoogleForm {
  formId: string
  info?: { title?: string; documentTitle?: string }
  responderUri?: string
  settings?: { emailCollectionType?: string }
  items?: Array<{
    title?: string
    questionItem?: { question?: FormQuestion }
    questionGroupItem?: { questions?: FormQuestion[]; grid?: { columns?: { type?: string; options?: Array<{ value?: string }> } } }
  }>
}

export interface PlannedField {
  questionId: string | null
  label: string
  field_type: string
  options: Array<{ label: string; value: string }> | null
}

export const EMAIL_QUESTION = '__respondent_email'
export const SUBMITTED_QUESTION = '__submitted_at'

function typeOf(q: FormQuestion): { field_type: string; options: PlannedField['options'] } {
  if (q.choiceQuestion) {
    const opts = (q.choiceQuestion.options ?? [])
      .filter((o) => !o.isOther && o.value)
      .map((o) => ({ label: o.value!, value: o.value! }))
    return { field_type: q.choiceQuestion.type === 'CHECKBOX' ? 'multiselect' : 'select', options: opts }
  }
  if (q.textQuestion?.paragraph) return { field_type: 'textarea', options: null }
  if (q.scaleQuestion || q.ratingQuestion) return { field_type: 'number', options: null }
  if (q.dateQuestion) return { field_type: q.dateQuestion.includeTime ? 'datetime' : 'date', options: null }
  if (q.timeQuestion) return { field_type: 'time', options: null }
  return { field_type: 'text', options: null }
}

/** The fields a form's table gets, in the form's order. */
export function planFields(form: GoogleForm): PlannedField[] {
  const out: PlannedField[] = []
  for (const item of form.items ?? []) {
    const title = item.title?.trim() || 'Question'
    const q = item.questionItem?.question
    if (q?.questionId) {
      const t = q.fileUploadQuestion ? { field_type: 'textarea', options: null } : typeOf(q)
      out.push({ questionId: q.questionId, label: title, ...t })
      continue
    }
    const group = item.questionGroupItem
    if (group?.questions?.length) {
      const cols = (group.grid?.columns?.options ?? []).filter((o) => o.value).map((o) => ({ label: o.value!, value: o.value! }))
      const several = group.grid?.columns?.type === 'CHECKBOX'
      for (const row of group.questions) {
        if (!row.questionId) continue
        out.push({
          questionId: row.questionId,
          label: `${title} — ${row.rowQuestion?.title?.trim() || 'row'}`,
          field_type: several ? 'multiselect' : 'select',
          options: cols,
        })
      }
    }
  }
  const collects = form.settings?.emailCollectionType && form.settings.emailCollectionType !== 'DO_NOT_COLLECT'
  if (collects) out.unshift({ questionId: EMAIL_QUESTION, label: 'Email', field_type: 'email', options: null })
  out.push({ questionId: SUBMITTED_QUESTION, label: 'Submitted at', field_type: 'datetime', options: null })
  return out
}

interface FormResponse {
  responseId: string
  createTime?: string
  lastSubmittedTime?: string
  respondentEmail?: string
  answers?: Record<string, {
    textAnswers?: { answers?: Array<{ value?: string }> }
    fileUploadAnswers?: { answers?: Array<{ fileId?: string; fileName?: string }> }
  }>
}

/** One response as a record's data, keyed by the table's fields. */
export function responseToData(r: FormResponse, map: Record<string, string>, multi: ReadonlySet<string>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [qid, a] of Object.entries(r.answers ?? {})) {
    const key = map[qid]
    if (!key) continue
    const files = a.fileUploadAnswers?.answers ?? []
    if (files.length) {
      data[key] = files.map((f) => `${f.fileName ?? 'file'}: https://drive.google.com/open?id=${f.fileId}`).join('\n')
      continue
    }
    const values = (a.textAnswers?.answers ?? []).map((x) => x.value ?? '').filter((v) => v !== '')
    if (values.length === 0) continue
    data[key] = multi.has(key) ? values : values.join(', ')
  }
  if (map[EMAIL_QUESTION] && r.respondentEmail) data[map[EMAIL_QUESTION]] = r.respondentEmail.trim().toLowerCase()
  const at = r.lastSubmittedTime ?? r.createTime
  if (map[SUBMITTED_QUESTION] && at) data[map[SUBMITTED_QUESTION]] = at
  return data
}

function keyFor(label: string, used: Set<string>): string {
  const base = (slugify(label).replace(/-/g, '_') || 'field').slice(0, 50)
  let key = base === 'table' ? 'field' : base
  let i = 2
  while (used.has(key)) key = `${base}_${i++}`
  used.add(key)
  return key
}

/** Picks a form: makes its table and the link, then brings in what is there. */
export async function linkGoogleForm(accountId: string, formId: string): Promise<{ linkId: string; tableId: string; imported: number }> {
  await ensureGoogleTables()
  if (!(await isGoogleServiceEnabled(accountId, 'forms'))) throw new FormsError('Turn on Google Forms in Settings → Google first.', 400)
  if (!/^[\w-]{10,200}$/.test(formId)) throw new FormsError('That is not a Google Form.', 400)
  const already = await prisma.googleFormLink.findFirst({ where: { account_id: accountId, form_id: formId }, select: { id: true } })
  if (already) throw new FormsError('That form is already linked.', 409)

  const token = await googleAccessToken(accountId)
  const form = await forms<GoogleForm>(token, `/forms/${encodeURIComponent(formId)}`)
  const name = (form.info?.title || form.info?.documentTitle || 'Google Form').trim().slice(0, 120)
  const planned = planFields(form)
  if (planned.length <= 1) throw new FormsError('That form has no questions yet.', 400)

  const baseSlug = slugify(name)
  const taken = new Set(
    (await prisma.dataTable.findMany({ where: { account_id: accountId, slug: { startsWith: baseSlug } }, select: { slug: true } })).map((t) => t.slug),
  )
  let slug = baseSlug
  for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`

  const used = new Set<string>()
  const keyed = planned.map((f) => ({ ...f, field_key: keyFor(f.label, used) }))
  const questionMap: Record<string, string> = {}
  for (const f of keyed) if (f.questionId) questionMap[f.questionId] = f.field_key

  const { table, link } = await prisma.$transaction(async (tx) => {
    const table = await tx.dataTable.create({
      data: { account_id: accountId, name, slug, icon: 'clipboard', description: 'Responses from a Google Form, brought in every 15 minutes.' },
    })
    await tx.dataField.createMany({
      data: keyed.map((f, i) => ({
        table_id: table.id,
        account_id: accountId,
        label: f.label.slice(0, 200),
        field_key: f.field_key,
        field_type: f.field_type,
        options: f.options ? ({ select_items: f.options } as Prisma.InputJsonValue) : undefined,
        sort_order: i,
      })),
    })
    const link = await tx.googleFormLink.create({
      data: {
        account_id: accountId,
        table_id: table.id,
        form_id: formId,
        form_title: name,
        responder_url: form.responderUri ?? null,
        question_map: questionMap,
      },
    })
    return { table, link }
  })
  const res = await syncGoogleForm(link.id, accountId).catch((err) => {
    console.error('[google-forms] first sync failed:', err instanceof Error ? err.message : err)
    return { imported: 0 }
  })
  return { linkId: link.id, tableId: table.id, imported: res.imported }
}

const syncing = new Set<string>()

/** New responses into the table. Safe to run as often as wanted. */
export async function syncGoogleForm(linkId: string, accountId: string): Promise<{ imported: number }> {
  if (syncing.has(linkId)) throw new FormsError('This form is already being read.', 409)
  syncing.add(linkId)
  try {
    const link = await prisma.googleFormLink.findFirst({ where: { id: linkId, account_id: accountId } })
    if (!link) throw new FormsError('That form link no longer exists.', 404)
    try {
      if (!(await isGoogleServiceEnabled(accountId, 'forms'))) throw new FormsError('Google Forms is switched off in Settings → Google.', 400)
      const token = await googleAccessToken(accountId)
      const all: FormResponse[] = []
      let pageToken = ''
      do {
        const res = await forms<{ responses?: FormResponse[]; nextPageToken?: string }>(
          token,
          `/forms/${encodeURIComponent(link.form_id)}/responses?pageSize=5000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        )
        all.push(...(res.responses ?? []))
        pageToken = res.nextPageToken ?? ''
      } while (pageToken && all.length < MAX_IMPORTED_IDS)

      const seen = new Set(link.imported_ids)
      const fresh = all
        .filter((r) => r.responseId && !seen.has(r.responseId))
        .sort((a, b) => (a.createTime ?? '').localeCompare(b.createTime ?? ''))
      const map = (link.question_map ?? {}) as Record<string, string>
      const multi = new Set(
        (await prisma.dataField.findMany({ where: { table_id: link.table_id, field_type: 'multiselect' }, select: { field_key: true } })).map((f) => f.field_key),
      )

      let imported = 0
      const { afterRecordCreated } = await import('@/lib/data-store/record-events')
      // One at a time, oldest first, and the id remembered as each lands:
      // a failure halfway leaves nothing to bring in twice.
      for (const r of fresh) {
        const data = responseToData(r, map, multi)
        if (Object.keys(data).length > 0) {
          const rec = await prisma.dataRecord.create({
            data: { table_id: link.table_id, account_id: accountId, data: data as Prisma.InputJsonValue, source: 'google_form' },
          })
          // A large backlog is not a flood of alerts: only the first sync's
          // last few, and every later one, go through the normal hooks.
          if (link.imported_ids.length > 0 || fresh.length <= 5) {
            afterRecordCreated({ ...rec, source: 'google_form' })
          }
          imported++
        }
        seen.add(r.responseId)
        await prisma.googleFormLink.update({
          where: { id: link.id },
          data: { imported_ids: { push: r.responseId } },
        })
      }
      if (imported > 0 && !(link.imported_ids.length > 0 || fresh.length <= 5)) {
        const { scheduleKnowledgeRefresh } = await import('@/lib/ai/knowledge-refresh')
        scheduleKnowledgeRefresh(accountId, link.table_id)
      }
      const ids = [...seen]
      await prisma.googleFormLink.update({
        where: { id: link.id },
        data: { ...(ids.length > MAX_IMPORTED_IDS ? { imported_ids: ids.slice(-MAX_IMPORTED_IDS) } : {}), last_synced_at: new Date(), last_error: null },
      })
      return { imported }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.googleFormLink.update({ where: { id: link.id }, data: { last_error: message } }).catch(() => {})
      throw err
    }
  } finally {
    syncing.delete(linkId)
  }
}

/** Every 15 minutes from server.ts. */
export async function sweepGoogleForms(): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const links = await prisma.googleFormLink.findMany({ where: { auto_sync: true }, select: { id: true, account_id: true } }).catch(() => [])
  for (const l of links) {
    await syncGoogleForm(l.id, l.account_id).catch((err) =>
      console.error('[google-forms] scheduled sync failed:', err instanceof Error ? err.message : err),
    )
  }
}
