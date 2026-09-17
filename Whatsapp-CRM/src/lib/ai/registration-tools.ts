/**
 * The only tools the customer assistant has that write.
 *
 * Kept apart from the read-only ones on purpose. Everything in
 * customer-tools.ts answers a question; everything here changes the
 * database, and the difference is worth being able to see at a glance in
 * the file tree rather than having to read a hundred lines to find it.
 *
 * Each one is scoped twice over: to a table the account has explicitly
 * opened to the assistant, and to the single contact whose conversation
 * this is. Neither scope is ever supplied by the model.
 *
 * The flow they support is two-stage by design — collect what is
 * required, save, *then* offer the rest. A customer who has answered four
 * questions and been told they are registered will often answer four
 * more; one facing twelve questions before anything is saved frequently
 * answers none, and there is no record they were ever interested.
 */

import { SchemaType, type FunctionDeclaration } from '@google/generative-ai'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { listRegistrationForms, validateValues } from './registration'

export interface RegistrationToolContext {
  accountId: string
  contactId: string
}

export interface RegistrationToolImpl {
  declaration: FunctionDeclaration
  run: (
    args: Record<string, unknown>,
    ctx: RegistrationToolContext,
  ) => Promise<unknown>
}

/** Matches the cap the read-only tools use — a customer has a handful of
 *  registrations, and an unbounded list would eat the prompt budget the
 *  knowledge base needs. */
const MAX_ROWS = 5

function humanDate(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** One value, reduced to what a person would call "the same answer".
 *  Case and surrounding space are not a meaningful difference between
 *  two registrations. */
function normalizeForMatch(value: unknown): string {
  if (value === undefined || value === null) return ''
  const raw = String(value).trim()

  // A date first, because two spellings of one date are the commonest
  // way a comparison like this quietly fails. This account's table holds
  // the same start date as "29/09/2026" on one row and "2026-09-29" on
  // the next — both written by the assistant, days apart. Compared as
  // text those are two different programmes and the duplicate slips
  // through, which is precisely the case somebody would pick "From Date"
  // to catch.
  const asDate = canonicalDate(raw)
  if (asDate) return asDate

  return (
    raw
      .toLowerCase()
      // Underscores and hyphens become spaces before collapsing: the
      // same table holds "Statutory Training Programme" and
      // "statutory_training_programme" as two rows of one programme.
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * A date in any of the usual spellings, reduced to yyyy-mm-dd.
 *
 * Returns null for anything that is not clearly a date, so ordinary text
 * falls through to the text comparison untouched.
 *
 * Day-first is assumed when the order is ambiguous. That is the local
 * convention and what the Data Store itself displays — and in any case
 * the rule only has to be *consistent*, since both sides of every
 * comparison pass through here.
 */
function canonicalDate(raw: string): string | null {
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw)
  if (iso) return pad(iso[1], iso[2], iso[3])

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw)
  if (dmy) {
    const [, a, b, year] = dmy
    // Only one reading is possible when a value is above twelve.
    const dayFirst = Number(a) > 12 ? true : Number(b) > 12 ? false : true
    return dayFirst ? pad(year, b, a) : pad(year, a, b)
  }

  return null
}

function pad(year: string, month: string, day: string): string | null {
  const m = Number(month)
  const d = Number(day)
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function blanksIn(
  data: Record<string, unknown>,
  fields: { key: string; label: string }[],
): string[] {
  return fields
    .filter((f) => {
      const v = data[f.key]
      return v === undefined || v === null || String(v).trim() === ''
    })
    .map((f) => f.label)
}

export const REGISTRATION_TOOLS: Record<string, RegistrationToolImpl> = {
  registration_forms: {
    declaration: {
      name: 'registration_forms',
      description:
        'What this business can register or book someone for, and which details each one needs. ' +
        'Call this FIRST, before asking the customer for anything — the fields differ by business ' +
        'and by form, and must not be guessed. Returns nothing if this business takes no ' +
        'registrations through chat.',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const forms = await listRegistrationForms(ctx.accountId)
      if (forms.length === 0) {
        return { found: false, note: 'This business does not take registrations through chat.' }
      }
      return { found: true, forms }
    },
  },

  submit_registration: {
    declaration: {
      name: 'submit_registration',
      description:
        'Register this customer, once every REQUIRED field for the form has been collected. ' +
        'Ask only for the required fields first, never the optional ones before saving. After it ' +
        'succeeds, tell them they are registered, then offer the optional details by name and let ' +
        'them say yes or no.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          table_id: {
            type: SchemaType.STRING,
            description: 'The table_id of the form, exactly as registration_forms returned it.',
          },
          values: {
            type: SchemaType.OBJECT,
            description:
              'The answers, keyed by each field key from registration_forms. Use the key, not the label.',
            properties: {},
          },
        },
        required: ['table_id', 'values'],
      },
    },
    async run(args, ctx) {
      const tableId = String(args.table_id ?? '')
      const forms = await listRegistrationForms(ctx.accountId)
      const form = forms.find((f) => f.table_id === tableId)
      if (!form) {
        return {
          error: 'That form does not exist. Call registration_forms and use a table_id from it.',
        }
      }

      const check = validateValues(
        [...form.required_fields, ...form.optional_fields],
        (args.values ?? {}) as Record<string, unknown>,
        { requireAll: true },
      )
      // Handed straight back to the model, which turns each line into the
      // next question it asks the customer.
      if (!check.ok) return { saved: false, problems: check.problems }

      // Already registered?
      //
      // Enforced here rather than left to the prompt. A model asked not
      // to double-register will mostly comply and will sometimes not,
      // and "sometimes" is two confirmation messages, two seats held and
      // an awkward phone call. What counts as a duplicate is the
      // account's own rule -- one per person per programme, per doctor
      // per date, or nothing at all -- so an account that has set no
      // rule keeps today's behaviour exactly.
      if (form.unique_by.length > 0) {
        const mine = await prisma.dataRecord.findMany({
          where: {
            table_id: form.table_id,
            account_id: ctx.accountId,
            contact_id: ctx.contactId,
          },
          select: { id: true, data: true, created_at: true },
        })
        const clash = mine.find((row) => {
          const existing = (row.data as Record<string, unknown>) ?? {}
          // Compared case- and space-insensitively: "STP" and "stp " are
          // the same programme to a person, and a duplicate check only a
          // machine agrees with is worse than none.
          return form.unique_by.every(
            (key) => normalizeForMatch(existing[key]) === normalizeForMatch(check.values[key]),
          )
        })
        if (clash) {
          const clashData = (clash.data as Record<string, unknown>) ?? {}
          const allFields = [...form.required_fields, ...form.optional_fields]
          const shown = form.unique_by
            .map((k) => {
              const field = allFields.find((f) => f.key === k)
              return field ? `${field.label}: ${String(clashData[k] ?? '')}` : null
            })
            .filter((v): v is string => v !== null)
            .join(', ')
          return {
            saved: false,
            already_registered: true,
            registration_id: clash.id,
            registered_on: humanDate(clash.created_at),
            // Written as a sentence, because it goes back to the model
            // and comes out as what the customer hears.
            say:
              `They are already registered for this (${shown}), on ${humanDate(clash.created_at)}. ` +
              'Tell them so in your own words, do not register them again, and offer to change or ' +
              'cancel the existing one if that is what they want.',
          }
        }
      }

      // Is there room left?
      //
      // Deliberately after the duplicate check, because "you are already
      // registered for this" is a more useful thing to hear than "it is
      // full" when both are true of the same person.
      //
      // Counted across every customer, not just this one: a seat taken
      // by somebody else is still taken. That is the whole difference
      // between this check and the one above, and it is the one that
      // actually stops an over-booking.
      if (form.capacity_by.length > 0 && form.capacity_limit !== null) {
        const sameTable = await prisma.dataRecord.findMany({
          where: { table_id: form.table_id, account_id: ctx.accountId },
          select: { data: true },
        })
        const taken = sameTable.filter((row) => {
          const existing = (row.data as Record<string, unknown>) ?? {}
          return form.capacity_by.every(
            (key) => normalizeForMatch(existing[key]) === normalizeForMatch(check.values[key]),
          )
        }).length

        if (taken >= form.capacity_limit) {
          const allFields = [...form.required_fields, ...form.optional_fields]
          const shown = form.capacity_by
            .map((k) => {
              const field = allFields.find((f) => f.key === k)
              return field ? `${field.label}: ${String(check.values[k] ?? '')}` : null
            })
            .filter((v): v is string => v !== null)
            .join(', ')
          return {
            saved: false,
            full: true,
            places_taken: taken,
            places_total: form.capacity_limit,
            say:
              `This is full (${shown}) — all ${form.capacity_limit} places are taken. ` +
              'Tell them so plainly, do not register them, and offer to put them down for a ' +
              'later one or have a colleague call them if something frees up.',
          }
        }
      }

      const record = await prisma.dataRecord.create({
        data: {
          table_id: form.table_id,
          account_id: ctx.accountId,
          contact_id: ctx.contactId,
          data: check.values as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      const table = await prisma.dataTable.findUnique({
        where: { id: form.table_id },
        select: { ai_success_message: true },
      })

      return {
        saved: true,
        registration_id: record.id,
        form: form.name,
        say: table?.ai_success_message?.trim() || `Registered for ${form.name}.`,
        // Labels, so the model can offer them in conversation one at a
        // time rather than reciting a form.
        optional_details_you_may_now_offer: form.optional_fields.map((f) => f.label),
      }
    },
  },

  add_registration_details: {
    declaration: {
      name: 'add_registration_details',
      description:
        'Fill in optional details on a registration this customer already made. Use it after they ' +
        'agree to give more, and for any later correction they ask for. Only their own ' +
        'registrations can be changed.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          registration_id: {
            type: SchemaType.STRING,
            description:
              'The registration_id returned by submit_registration, or by my_registrations.',
          },
          values: {
            type: SchemaType.OBJECT,
            description: 'The extra answers, keyed by field key.',
            properties: {},
          },
        },
        required: ['registration_id', 'values'],
      },
    },
    async run(args, ctx) {
      // Scoped to this contact in the query itself. A registration id is
      // a uuid the model has already seen, so "only their own" has to be
      // a condition the database enforces rather than a rule the model is
      // trusted to keep.
      const record = await prisma.dataRecord.findFirst({
        where: {
          id: String(args.registration_id ?? ''),
          account_id: ctx.accountId,
          contact_id: ctx.contactId,
        },
        select: { id: true, table_id: true, data: true },
      })
      if (!record) {
        return { error: 'No registration of theirs with that id. Check my_registrations first.' }
      }

      const forms = await listRegistrationForms(ctx.accountId)
      const form = forms.find((f) => f.table_id === record.table_id)
      if (!form) return { error: 'That registration can no longer be changed through chat.' }

      // requireAll is false: this is the second pass, and somebody giving
      // one more detail must not be asked again for what they already
      // gave.
      const check = validateValues(
        [...form.required_fields, ...form.optional_fields],
        (args.values ?? {}) as Record<string, unknown>,
        { requireAll: false },
      )
      if (!check.ok) return { saved: false, problems: check.problems }

      const merged = {
        ...((record.data as Record<string, unknown>) ?? {}),
        ...check.values,
      }
      await prisma.dataRecord.update({
        where: { id: record.id },
        data: { data: merged as Prisma.InputJsonValue },
      })

      return {
        saved: true,
        registration_id: record.id,
        still_missing: blanksIn(merged, form.optional_fields),
      }
    },
  },

  my_registrations: {
    declaration: {
      name: 'my_registrations',
      description:
        "This customer's own registrations and bookings, with what they gave and what is still " +
        'blank. Use it when they ask what they signed up for, and before changing anything.',
      parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    async run(_args, ctx) {
      const records = await prisma.dataRecord.findMany({
        where: { account_id: ctx.accountId, contact_id: ctx.contactId },
        orderBy: { created_at: 'desc' },
        take: MAX_ROWS,
        select: { id: true, table_id: true, data: true, created_at: true },
      })
      if (records.length === 0) return { found: false }

      const forms = await listRegistrationForms(ctx.accountId)
      return {
        found: true,
        registrations: records.map((r) => {
          const form = forms.find((f) => f.table_id === r.table_id)
          const data = (r.data as Record<string, unknown>) ?? {}
          return {
            registration_id: r.id,
            form: form?.name ?? 'Registration',
            registered_on: humanDate(r.created_at),
            details: data,
            still_missing: form ? blanksIn(data, form.optional_fields) : [],
          }
        }),
      }
    },
  },
}

/**
 * Told to the model only when the account has actually opened a form.
 *
 * A business that takes no registrations should not have its assistant
 * carrying instructions about how to take one — it invites the model to
 * offer something that does not exist.
 */
export const REGISTRATION_INSTRUCTION = [
  'TAKING A REGISTRATION:',
  '- Call registration_forms before asking for anything. The fields are different for every business; never assume them.',
  '- Ask for the REQUIRED fields only, a few at a time, in the language the customer is using.',
  '- As soon as you have all of them, call submit_registration. Do not collect optional details first — saving early means a customer who stops replying is still registered.',
  '- After it saves, confirm it, then offer the optional details by name and let them answer yes or no. If they say no, thank them and stop asking.',
  '- If a save comes back with problems, they are the exact things to ask again. Read them out in your own words; never show field keys or error text to the customer.',
  '- You can only see and change this customer’s own registrations.',
  '- If a save comes back saying it is full, say so and do not try again. Offer a later date or a callback.',
  '- If a save comes back saying they are already registered, say so in your own words and do not try again. Offer to change or cancel the existing one instead.',
].join('\n')
