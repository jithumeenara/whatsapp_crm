/**
 * Registering somebody from a photo or file they sent.
 *
 * Instead of typing their details one question at a time, a customer
 * sends a picture of them — a filled form, a note, a letter. The reading
 * (image-reading.ts) maps what it sees onto one of the account's own
 * registration forms; from there this file takes over:
 *
 *   1. Whatever the photo cannot say — which programme, which month, which
 *      doctor, which slot — is chosen from the business's live list, with
 *      WhatsApp list messages. When there are more choices than one list
 *      holds and they have dates, the month is asked first.
 *   2. Any other required detail still missing is asked for, one at a time.
 *   3. Everything is shown back together, with "Yes, register" / "No,
 *      change" buttons. Yes saves it through the very same path the
 *      assistant uses (validation, duplicates, capacity, alerts); No lets
 *      them pick the detail to correct.
 *
 * The steps are decided here, in code, not by the model: it cannot skip
 * one, and it cannot offer a choice that is not in the list. A typed
 * registration (no photo) is unchanged and still saves straight away —
 * the account's choice.
 *
 * One person per photo. A list of several goes to the team, who register
 * a group by hand (group registration is a later step).
 *
 * The draft is one row per conversation in registration_drafts, its
 * values encrypted (they can hold bank details, which the account keeps
 * in full), deleted as soon as the registration is saved or cancelled,
 * and ignored after a day.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { engineSendInteractiveButtons, engineSendInteractiveList, engineSendText } from '@/lib/flows/meta-send'
import { getFieldConfig, type FieldConfig, type SelectOption } from '@/lib/data-store/types'
import { listRegistrationForms, validateValues, type RegistrationField, type RegistrationForm } from './registration'
import { REGISTRATION_TOOLS } from './registration-tools'
import { languageOf } from './handover-consent'
import type { RegistrationExtract } from './image-reading'
import {
  allFields,
  asButtons,
  buttonTitle,
  choiceRows,
  editRows,
  inMonth,
  isBlank,
  isCancel,
  looksLikeSomethingElse,
  matchChoice,
  matchField,
  matchMonth,
  monthLabel,
  monthRows,
  monthsOf,
  needsMonth,
  nextMissing,
  optionHash,
  parseReplyId,
  replyId,
  shortId,
  summaryText,
  TEXT,
  toIsoDate,
  upcoming,
  type Choice,
  type Lang,
  type Step,
} from './registration-draft-core'
import { consentFromText } from './handover-consent'

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
/** Corrections allowed before the team takes over. */
const MAX_EDITS = 3

const STARTED_NOTE = 'Registration from a photo started'

// ── Storage ─────────────────────────────────────────────────────────

function ensureTable(): Promise<void> {
  return onceSchemaPatch('registration_drafts', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS registration_drafts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        table_id uuid NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
        values_enc text NOT NULL,
        step text NOT NULL,
        field_key text,
        month text,
        page integer NOT NULL DEFAULT 0,
        lang text NOT NULL DEFAULT 'en',
        edits integer NOT NULL DEFAULT 0,
        source_message_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      )`)
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_drafts_conversation ON registration_drafts (conversation_id)',
    )
  })
}

interface Draft {
  id: string
  accountId: string
  conversationId: string
  contactId: string
  tableId: string
  values: Record<string, string>
  step: Step
  fieldKey: string | null
  month: string | null
  page: number
  lang: Lang
  edits: number
}

interface DraftRow {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  table_id: string
  values_enc: string
  step: string
  field_key: string | null
  month: string | null
  page: number
  lang: string
  edits: number
}

async function loadDraft(accountId: string, conversationId: string): Promise<Draft | null> {
  await ensureTable()
  const rows = await prisma.$queryRaw<DraftRow[]>(Prisma.sql`
    SELECT id, account_id, conversation_id, contact_id, table_id, values_enc, step, field_key, month, page, lang, edits
    FROM registration_drafts
    WHERE conversation_id = ${conversationId}::uuid AND account_id = ${accountId}::uuid AND expires_at > now()`)
  const r = rows[0]
  if (!r) return null
  let values: Record<string, string> = {}
  try {
    values = JSON.parse(decrypt(r.values_enc)) as Record<string, string>
  } catch {
    return null
  }
  return {
    id: r.id,
    accountId: r.account_id,
    conversationId: r.conversation_id,
    contactId: r.contact_id,
    tableId: r.table_id,
    values,
    step: r.step as Step,
    fieldKey: r.field_key,
    month: r.month,
    page: r.page,
    lang: r.lang === 'ml' ? 'ml' : 'en',
    edits: r.edits,
  }
}

async function saveDraft(d: Draft, sourceMessageId?: string): Promise<Draft> {
  await ensureTable()
  // Drafts nobody finished hold people's details (bank ones included):
  // gone a day after they lapse, not kept indefinitely.
  await prisma
    .$executeRaw(Prisma.sql`DELETE FROM registration_drafts WHERE expires_at < now() - interval '1 day'`)
    .catch(() => {})
  const enc = encrypt(JSON.stringify(d.values))
  const expires = new Date(Date.now() + DRAFT_TTL_MS)
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO registration_drafts
      (account_id, conversation_id, contact_id, table_id, values_enc, step, field_key, month, page, lang, edits, source_message_id, expires_at)
    VALUES (${d.accountId}::uuid, ${d.conversationId}::uuid, ${d.contactId}::uuid, ${d.tableId}::uuid, ${enc}, ${d.step},
            ${d.fieldKey}, ${d.month}, ${d.page}, ${d.lang}, ${d.edits}, ${sourceMessageId ?? null}::uuid, ${expires})
    ON CONFLICT (conversation_id) DO UPDATE SET
      table_id = EXCLUDED.table_id, values_enc = EXCLUDED.values_enc, step = EXCLUDED.step,
      field_key = EXCLUDED.field_key, month = EXCLUDED.month, page = EXCLUDED.page, lang = EXCLUDED.lang,
      edits = EXCLUDED.edits, contact_id = EXCLUDED.contact_id,
      source_message_id = COALESCE(EXCLUDED.source_message_id, registration_drafts.source_message_id),
      updated_at = now(), expires_at = EXCLUDED.expires_at
    RETURNING id`)
  return { ...d, id: rows[0].id }
}

async function deleteDraft(conversationId: string): Promise<void> {
  await ensureTable()
  await prisma.$executeRaw(Prisma.sql`DELETE FROM registration_drafts WHERE conversation_id = ${conversationId}::uuid`)
}

/** True while a photo registration is under way in this conversation —
 *  the assistant is told, so it answers questions without starting a
 *  registration of its own on top. */
export async function activeDraftWaitingFor(accountId: string, conversationId: string): Promise<string | null> {
  try {
    const d = await loadDraft(accountId, conversationId)
    if (!d) return null
    const form = (await listRegistrationForms(accountId)).find((f) => f.table_id === d.tableId)
    if (!form) return null
    if (d.step === 'confirm') return 'their Yes / No on the summary of their details'
    const field = allFields(form).find((f) => f.key === d.fieldKey) ?? nextMissing(form, d.values)
    return field ? `their ${field.label}` : 'their answer'
  } catch {
    return null
  }
}

// ── Sending ─────────────────────────────────────────────────────────

interface Ctx {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
}

async function say(ctx: Ctx, text: string): Promise<void> {
  await engineSendText({ ...ctx, text })
}

async function note(conversationId: string, text: string): Promise<void> {
  await prisma.message.create({
    data: { conversation_id: conversationId, sender_type: 'system', content_type: 'text', content_text: text, status: 'sent' },
  })
}

async function toTeam(ctx: Ctx, d: Draft, reason: string, customerText: string): Promise<void> {
  await deleteDraft(ctx.conversationId).catch(() => {})
  await say(ctx, customerText).catch(() => {})
  const { handOver } = await import('./auto-reply')
  await handOver({ accountId: ctx.accountId, conversationId: ctx.conversationId, note: `${reason}\n\nNothing was saved; please finish this registration with them.` })
}

// ── Choices ─────────────────────────────────────────────────────────

/**
 * A choice field's live options, each with its date when the table the
 * options come from has a date column — the first one, in that table's
 * own order. Only those still open.
 */
async function choicesFor(accountId: string, tableId: string, field: RegistrationField): Promise<Choice[]> {
  const options = field.options ?? []
  const dates = new Map<string, string>()
  try {
    const def = await prisma.dataField.findFirst({
      where: { table_id: tableId, field_key: field.key },
      select: { options: true },
    })
    const config = getFieldConfig((def?.options ?? null) as FieldConfig | SelectOption[] | null)
    if (config.source_table_id && config.source_field_key) {
      const dateField = await prisma.dataField.findFirst({
        where: { table_id: config.source_table_id, field_type: { in: ['date', 'datetime'] } },
        orderBy: { sort_order: 'asc' },
        select: { field_key: true },
      })
      if (dateField) {
        const rows = await prisma.dataRecord.findMany({
          where: { table_id: config.source_table_id, account_id: accountId },
          select: { data: true },
          take: 500,
        })
        for (const row of rows) {
          const data = (row.data as Record<string, unknown>) ?? {}
          const value = String(data[config.source_field_key] ?? '').trim()
          const date = toIsoDate(data[dateField.field_key])
          if (!value || !date) continue
          // The soonest date wins when a value repeats.
          const known = dates.get(value)
          if (!known || date < known) dates.set(value, date)
        }
      }
    }
  } catch {
    // Without dates the choices are simply listed.
  }
  const today = new Date().toISOString().slice(0, 10)
  return upcoming(options.map((value) => ({ value, date: dates.get(value) ?? null })), today)
}

// ── Asking ──────────────────────────────────────────────────────────

/** Asks for one field: from a list when it has options, else in words. */
async function askField(ctx: Ctx, d: Draft, form: RegistrationForm, field: RegistrationField, intro?: string): Promise<void> {
  const t = TEXT[d.lang]
  const prefix = intro ? `${intro}\n\n` : ''

  if (field.options?.length) {
    const choices = await choicesFor(ctx.accountId, form.table_id, field)
    if (choices.length === 0) {
      await toTeam(ctx, d, `${STARTED_NOTE} (${form.name}), but "${field.label}" has nothing open to choose.`, t.nothingOpen)
      return
    }
    if (needsMonth(choices)) {
      const months = monthsOf(choices)
      const saved = await saveDraft({ ...d, step: 'choose_month', fieldKey: field.key, month: null, page: 0 })
      await engineSendInteractiveList({
        ...ctx,
        bodyText: `${prefix}${t.month}`,
        buttonLabel: buttonTitle(t.chooseButton),
        sections: [{ title: field.label.slice(0, 24), rows: monthRows(saved.id, months, d.lang, choices) }],
      })
      return
    }
    const saved = await saveDraft({ ...d, step: 'choose', fieldKey: field.key, month: null, page: 0 })
    await sendChoices(ctx, saved, field, choices, prefix)
    return
  }

  await saveDraft({ ...d, step: 'ask', fieldKey: field.key, month: null, page: 0 })
  await say(ctx, `${prefix}${field.type === 'date' ? t.askDate(field.label) : t.ask(field.label)}`)
}

async function sendChoices(ctx: Ctx, d: Draft, field: RegistrationField, all: Choice[], prefix = ''): Promise<void> {
  const t = TEXT[d.lang]
  const shown = inMonth(all, d.month)
  const body = `${prefix}${t.choose(field.label)}${d.month ? ` (${monthLabel(d.month, d.lang)})` : ''}`
  if (asButtons(shown) && d.page === 0) {
    await engineSendInteractiveButtons({
      ...ctx,
      bodyText: body,
      buttons: shown.map((c) => ({ id: replyId('option', d.id, optionHash(c.value)), title: c.value })),
    })
    return
  }
  await engineSendInteractiveList({
    ...ctx,
    bodyText: body,
    buttonLabel: buttonTitle(t.chooseButton),
    sections: [{ title: field.label.slice(0, 24), rows: choiceRows(d.id, shown, d.page, d.lang) }],
  })
}

/** The next thing to ask — or, with nothing missing, the summary. */
async function advance(ctx: Ctx, d: Draft, form: RegistrationForm, intro?: string): Promise<void> {
  const missing = nextMissing(form, d.values)
  if (missing) {
    await askField(ctx, d, form, missing, intro)
    return
  }
  const saved = await saveDraft({ ...d, step: 'confirm', fieldKey: null, month: null, page: 0 })
  const t = TEXT[d.lang]
  await engineSendInteractiveButtons({
    ...ctx,
    bodyText: `${intro ? `${intro}\n\n` : ''}${summaryText(form, saved.values, d.lang)}`.slice(0, 1024),
    buttons: [
      { id: replyId('yes', saved.id), title: buttonTitle(t.yes) },
      { id: replyId('no', saved.id), title: buttonTitle(t.no) },
    ],
  })
}

// ── Starting ────────────────────────────────────────────────────────

/** Values the photo gave that the form will accept, each checked on its
 *  own — one unreadable detail does not cost the rest. */
function acceptedValues(form: RegistrationForm, raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of allFields(form)) {
    const value = raw[field.key]
    if (isBlank(value)) continue
    const check = validateValues([field], { [field.key]: value }, { requireAll: false })
    if (check.ok && !isBlank(check.values[field.key])) out[field.key] = String(check.values[field.key])
  }
  return out
}

/** The customer's own WhatsApp number, for a "WhatsApp number" field the
 *  photo left empty. Shown in the summary, so it can be changed. */
async function fillOwnNumber(form: RegistrationForm, values: Record<string, string>, contactId: string): Promise<void> {
  const field = allFields(form).find(
    (f) => f.type === 'phone' && isBlank(values[f.key]) && /whats\s*app|mobile|phone/i.test(`${f.key} ${f.label}`) && !/emergency|guardian|parent|alternat|office/i.test(`${f.key} ${f.label}`),
  )
  if (!field) return
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } }).catch(() => null)
  if (contact?.phone) values[field.key] = contact.phone
}

/**
 * A reading that holds somebody's registration details: start (or add to)
 * the draft and ask the first thing still needed. 'not_registration' when
 * it cannot be used — the image is then handled like any other.
 */
export async function startRegistrationFromImage(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  sourceMessageId: string
  extract: RegistrationExtract
  languageSample: string
}): Promise<'started' | 'group' | 'not_registration'> {
  const form = (await listRegistrationForms(args.accountId)).find((f) => f.table_id === args.extract.tableId)
  if (!form) return 'not_registration'
  const ctx: Ctx = { accountId: args.accountId, userId: args.userId, conversationId: args.conversationId, contactId: args.contactId }
  const lang: Lang = languageOf(args.languageSample) === 'ml' ? 'ml' : 'en'

  if (args.extract.people > 1) {
    await toTeam(
      ctx,
      { id: '', accountId: args.accountId, conversationId: args.conversationId, contactId: args.contactId, tableId: form.table_id, values: {}, step: 'ask', fieldKey: null, month: null, page: 0, lang, edits: 0 },
      `The customer sent details for ${args.extract.people} people to register for ${form.name}. Group registration is done by the team.`,
      TEXT[lang].group,
    )
    return 'group'
  }

  const read = acceptedValues(form, args.extract.values)
  if (Object.keys(read).length === 0) return 'not_registration'

  // A second photo while one is under way adds to it (the back of a
  // card, a page that was missed); a different form starts afresh.
  const existing = await loadDraft(args.accountId, args.conversationId)
  const values = existing && existing.tableId === form.table_id ? { ...existing.values, ...read } : read
  await fillOwnNumber(form, values, args.contactId)

  const draft = await saveDraft(
    {
      id: existing?.id ?? '',
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      tableId: form.table_id,
      values,
      step: 'ask',
      fieldKey: null,
      month: null,
      page: 0,
      lang,
      edits: existing && existing.tableId === form.table_id ? existing.edits : 0,
    },
    args.sourceMessageId,
  )
  const labels = allFields(form).filter((f) => !isBlank(read[f.key])).map((f) => f.label)
  await note(args.conversationId, `${STARTED_NOTE} — ${form.name}. Read from it: ${labels.join(', ')}.`)
  await advance(ctx, draft, form, TEXT[lang].intro)
  return 'started'
}

// ── Answers ─────────────────────────────────────────────────────────

/**
 * The customer's message, while a photo registration is under way.
 * Returns false when it is not an answer to it — a question, say — and
 * the message is then handled as any other (the draft waits).
 */
export async function handleRegistrationReply(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  interactiveReplyId: string | null
}): Promise<boolean> {
  const tapped = parseReplyId(args.interactiveReplyId)
  const text = (args.text ?? '').trim()
  if (!tapped && !text) return false

  const d = await loadDraft(args.accountId, args.conversationId)
  if (!d) return false
  // A row or button from some earlier draft is not an answer to this one.
  if (tapped && tapped.short !== shortId(d.id)) return false

  const form = (await listRegistrationForms(args.accountId)).find((f) => f.table_id === d.tableId)
  if (!form) {
    await deleteDraft(args.conversationId)
    return false
  }
  const ctx: Ctx = { accountId: args.accountId, userId: args.userId, conversationId: args.conversationId, contactId: args.contactId }
  const t = TEXT[d.lang]

  if (tapped?.kind === 'cancel' || (!tapped && isCancel(text))) {
    await deleteDraft(args.conversationId)
    await note(args.conversationId, 'The customer cancelled the registration from their photo.')
    await say(ctx, t.cancelled)
    return true
  }

  const field = d.fieldKey ? allFields(form).find((f) => f.key === d.fieldKey) ?? null : null

  switch (d.step) {
    case 'choose_month': {
      if (!field) return false
      const choices = await choicesFor(args.accountId, form.table_id, field)
      const months = monthsOf(choices)
      const month = tapped?.kind === 'month' ? (months.includes(tapped.payload) ? tapped.payload : null) : matchMonth(text, months)
      if (!month) return false
      const next = await saveDraft({ ...d, step: 'choose', month, page: 0 })
      await sendChoices(ctx, next, field, choices)
      return true
    }

    case 'choose': {
      if (!field) return false
      const choices = await choicesFor(args.accountId, form.table_id, field)
      const shown = inMonth(choices, d.month)
      if (tapped?.kind === 'page') {
        const page = Math.max(0, Math.min(50, Number(tapped.payload) || 0))
        const next = await saveDraft({ ...d, page })
        await sendChoices(ctx, next, field, choices)
        return true
      }
      const picked =
        tapped?.kind === 'option'
          ? choices.find((c) => optionHash(c.value) === tapped.payload) ?? null
          : matchChoice(text, choices, shown.slice(0, 10))
      if (!picked) return false
      await advance(ctx, { ...d, values: { ...d.values, [field.key]: picked.value }, fieldKey: null, month: null, page: 0 }, form)
      return true
    }

    case 'ask': {
      const target = field ?? nextMissing(form, d.values)
      if (!target || tapped || looksLikeSomethingElse(text)) return false
      const check = validateValues([target], { [target.key]: text }, { requireAll: false })
      if (!check.ok || isBlank(check.values[target.key])) {
        await say(ctx, t.invalid(target.label))
        return true
      }
      await advance(ctx, { ...d, values: { ...d.values, [target.key]: String(check.values[target.key]) }, fieldKey: null }, form)
      return true
    }

    case 'confirm': {
      const answer = tapped ? (tapped.kind === 'yes' ? 'yes' : tapped.kind === 'no' ? 'no' : null) : consentFromText(text)
      if (!answer) return false
      if (answer === 'no') {
        await saveDraft({ ...d, step: 'pick_edit' })
        await engineSendInteractiveList({
          ...ctx,
          bodyText: t.pickEdit,
          buttonLabel: buttonTitle(t.chooseButton),
          sections: [{ title: form.name.slice(0, 24), rows: editRows(d.id, form, d.values, d.lang) }],
        })
        return true
      }
      await register(ctx, d, form)
      return true
    }

    case 'pick_edit': {
      const target =
        tapped?.kind === 'edit' ? allFields(form).find((f) => f.key === tapped.payload) ?? null : tapped ? null : matchField(text, form)
      if (!target) return false
      if (d.edits + 1 > MAX_EDITS) {
        await toTeam(ctx, d, `The customer corrected their details from a photo ${MAX_EDITS} times for ${form.name} and it is still not right.`, t.toTeam)
        return true
      }
      const values = { ...d.values }
      delete values[target.key]
      await askField(ctx, { ...d, values, edits: d.edits + 1 }, form, target)
      return true
    }
  }
  return false
}

/** Yes on the summary: saved exactly as the assistant saves a typed
 *  registration — the same checks for duplicates and for room. */
async function register(ctx: Ctx, d: Draft, form: RegistrationForm): Promise<void> {
  const t = TEXT[d.lang]
  const result = (await REGISTRATION_TOOLS.submit_registration.run(
    { table_id: form.table_id, values: d.values },
    { accountId: ctx.accountId, contactId: ctx.contactId },
  )) as { saved?: boolean; already_registered?: boolean; full?: boolean; problems?: string[]; say?: string; error?: string }

  if (result.saved) {
    await deleteDraft(ctx.conversationId)
    await note(ctx.conversationId, `Registered from a photo: ${form.name}. The customer confirmed every detail.`)
    const success = result.say && result.say !== `Registered for ${form.name}.` ? result.say : t.saved
    await say(ctx, success)
    return
  }
  if (result.already_registered) {
    await deleteDraft(ctx.conversationId)
    await note(ctx.conversationId, `Not registered from the photo: already registered for ${form.name}.`)
    await say(ctx, t.already)
    return
  }
  if (result.full) {
    await toTeam(ctx, d, `The customer confirmed their details from a photo for ${form.name}, but it is full.`, t.full)
    return
  }
  // Something the form still needs: ask for it rather than give up.
  if (nextMissing(form, d.values)) {
    await advance(ctx, d, form)
    return
  }
  await toTeam(
    ctx,
    d,
    `The registration from a photo for ${form.name} could not be saved: ${(result.problems ?? [result.error ?? 'unknown']).join(' ')}`,
    t.toTeam,
  )
}
