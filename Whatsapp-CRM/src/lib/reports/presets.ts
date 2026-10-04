/**
 * Ready reports: the questions almost every business asks, as saved
 * sentences. Nothing here is specific to one industry — an institute, a
 * clinic and a shop all win and lose leads, miss calls and take payments.
 * Their own tables add more (see dataStorePresets).
 */

import type { ReportSpec } from './engine'
import type { StoreTable } from './moments'

export interface Preset {
  id: string
  title: string
  description: string
  spec: ReportSpec
}

const spec = (s: Omit<ReportSpec, 'v'>): ReportSpec => ({ v: 1, ...s })

export const PRESET_REPORTS: Preset[] = [
  {
    id: 'win-rate-by-source',
    title: 'Win rate by source',
    description: 'Of the leads created, how many were won — split by where they came from.',
    spec: spec({ shape: 'from_to', moment: 'lead.created', to: 'lead.won', by: 'source', period: { preset: 'last_90_days' }, window_days: 90 }),
  },
  {
    id: 'win-rate-by-agent',
    title: 'Win rate by team member',
    description: 'Of the leads each person was given, how many they won, and how long it took.',
    spec: spec({ shape: 'from_to', moment: 'lead.created', to: 'lead.won', by: 'agent', period: { preset: 'last_90_days' }, window_days: 90 }),
  },
  {
    id: 'lost-reasons',
    title: 'Why leads were lost',
    description: 'Lost leads by the reason recorded when they were closed.',
    spec: spec({ shape: 'count', moment: 'lead.lost', by: 'lost_reason', period: { preset: 'last_90_days' } }),
  },
  {
    id: 'won-over-time',
    title: 'Leads won over time',
    description: 'How many leads were won, week by week.',
    spec: spec({ shape: 'count', moment: 'lead.won', period: { preset: 'last_90_days' } }),
  },
  {
    id: 'leads-by-source',
    title: 'New leads by source',
    description: 'Where this month’s leads came from, against the month before.',
    spec: spec({ shape: 'count', moment: 'lead.created', by: 'source', period: { preset: 'last_30_days' } }),
  },
  {
    id: 'new-conversations',
    title: 'New conversations',
    description: 'Customers starting a conversation, day by day.',
    spec: spec({ shape: 'count', moment: 'conversation.started', period: { preset: 'last_30_days' } }),
  },
  {
    id: 'enquiry-to-payment',
    title: 'Enquiry to payment',
    description: 'Of the customers who started a conversation, how many paid, and how soon.',
    spec: spec({ shape: 'from_to', moment: 'conversation.started', to: 'payment.received', period: { preset: 'last_90_days' }, window_days: 30 }),
  },
  {
    id: 'missed-calls',
    title: 'Missed calls',
    description: 'Calls nobody answered, day by day.',
    spec: spec({ shape: 'count', moment: 'call.missed', period: { preset: 'last_30_days' } }),
  },
  {
    id: 'payments-received',
    title: 'Payments received',
    description: 'Money collected through payment links, day by day.',
    spec: spec({ shape: 'sum', moment: 'payment.received', value: 'amount', period: { preset: 'last_30_days' } }),
  },
  {
    id: 'returning-customers',
    title: 'Returning customers',
    description: 'Customers who wrote in more than once.',
    spec: spec({ shape: 'again', moment: 'message.customer', period: { preset: 'last_30_days' } }),
  },
]

/** One ready report per Data Store table that has something to split by —
 *  "Appointments by Doctor", "Admissions by Course" — so each business's
 *  own data is reportable the day its table exists. */
export function dataStorePresets(tables: StoreTable[]): Preset[] {
  const out: Preset[] = []
  for (const t of tables) {
    const field = t.fields.find((f) => ['select', 'radio', 'district', 'country', 'boolean'].includes(f.field_type))
    out.push({
      id: `store-${t.id}`,
      title: field ? `${t.name} by ${field.label}` : `${t.name}: records added`,
      description: field ? `Records added to ${t.name}, split by ${field.label}.` : `Records added to ${t.name}, day by day.`,
      spec: spec({
        shape: 'count',
        moment: `record:${t.id}`,
        by: field ? `f:${field.field_key}` : null,
        period: { preset: 'last_30_days' },
      }),
    })
  }
  return out
}
