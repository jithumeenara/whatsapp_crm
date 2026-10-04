/**
 * Moments — every business event as one kind of thing.
 *
 * A customer wrote, a lead was won, a call was missed, a payment came in,
 * a row was added to one of this account's own tables: each is a moment,
 * with a time, usually a customer, and a few details worth splitting by.
 * Reports never ask about tables; they ask about moments, so the same four
 * questions (how many, how much, from one moment to another, again) work
 * for an institute, a hospital or a shop without a line of code per
 * industry. A new feature becomes reportable by adding one entry here.
 *
 * Nothing in this file takes text from a user into SQL. Every table,
 * column and expression below is a constant; the account, the Data Store
 * table and its field keys arrive as bound parameters ($n).
 *
 * Lead outcomes follow src/lib/leads/outcome.ts exactly — won is a closed
 * lead with converted_at, lost is a closed lead with a lost reason — so a
 * report and the Leads page can never disagree about who won.
 */

export class Params {
  readonly values: unknown[] = []
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

export interface PropDef {
  key: string
  label: string
  /** Values are user ids; the engine shows the person's name. */
  agent?: boolean
}

export interface ValueDef {
  key: string
  label: string
  unit?: 'INR' | 'min'
}

export interface MomentSql {
  from: string
  where: string
  at: string
  contact: string
  prop: Record<string, string>
  value: Record<string, string>
}

export interface MomentDef {
  kind: string
  label: string
  /** For sentences: "How many <noun>". */
  noun: string
  group: string
  props: PropDef[]
  values: ValueDef[]
  sql(p: Params, account: string): MomentSql
}

const CHANNEL: PropDef = { key: 'channel', label: 'Channel' }
const AGENT: PropDef = { key: 'agent', label: 'Team member', agent: true }

// ── Conversations ────────────────────────────────────────────────────

const conversationStarted: MomentDef = {
  kind: 'conversation.started',
  label: 'New conversation',
  noun: 'new conversations',
  group: 'Conversations',
  props: [CHANNEL, AGENT],
  values: [],
  sql: (_p, a) => ({
    from: 'conversations c',
    where: `c.account_id = ${a}::uuid`,
    at: 'c.created_at',
    contact: 'c.contact_id',
    prop: { channel: 'c.channel', agent: 'c.assigned_agent_id::text' },
    value: {},
  }),
}

function messageMoment(kind: string, label: string, noun: string, sender: string, agentExpr: string): MomentDef {
  return {
    kind,
    label,
    noun,
    group: 'Conversations',
    props: [CHANNEL, AGENT],
    values: [],
    sql: (_p, a) => ({
      from: 'messages m JOIN conversations c ON c.id = m.conversation_id',
      where: `c.account_id = ${a}::uuid AND m.sender_type = '${sender}' AND m.deleted_at IS NULL`,
      at: 'm.created_at',
      contact: 'c.contact_id',
      prop: { channel: 'c.channel', agent: agentExpr },
      value: {},
    }),
  }
}

// ── Leads ────────────────────────────────────────────────────────────

const LEAD_PROPS: PropDef[] = [
  { key: 'source', label: 'Source' },
  { key: 'district', label: 'District' },
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score' },
  { key: 'quality', label: 'Quality' },
  { key: 'call_outcome', label: 'Call outcome' },
  AGENT,
]

const leadProps = {
  source: 'l.source',
  district: 'l.district',
  status: 'l.status',
  score: 'l.score',
  quality: 'l.lead_quality',
  call_outcome: 'l.call_outcome',
  agent: 'l.assigned_to::text',
}

function leadMoment(kind: string, label: string, noun: string, extraWhere: string, at: string, extraProps: PropDef[] = [], extraExpr: Record<string, string> = {}): MomentDef {
  return {
    kind,
    label,
    noun,
    group: 'Leads',
    props: [...LEAD_PROPS, ...extraProps],
    values: [],
    sql: (_p, a) => ({
      from: 'leads l',
      where: `l.account_id = ${a}::uuid AND l.is_hidden = false${extraWhere}`,
      at,
      contact: 'l.contact_id',
      prop: { ...leadProps, ...extraExpr },
      value: {},
    }),
  }
}

// ── Calls ────────────────────────────────────────────────────────────

const CALL_PROPS: PropDef[] = [
  { key: 'status', label: 'Status' },
  { key: 'handled_by', label: 'Handled by' },
  CHANNEL,
  AGENT,
]

function callMoment(kind: string, label: string, noun: string, extraWhere: string): MomentDef {
  return {
    kind,
    label,
    noun,
    group: 'Calls',
    props: CALL_PROPS,
    values: [{ key: 'talk_minutes', label: 'Talk time', unit: 'min' }],
    sql: (_p, a) => ({
      from: 'calls k',
      where: `k.account_id = ${a}::uuid${extraWhere}`,
      at: 'k.started_at',
      contact: 'k.contact_id',
      prop: { status: 'k.status', handled_by: 'k.handled_by', channel: 'k.channel', agent: 'k.agent_id::text' },
      value: { talk_minutes: 'k.duration_seconds / 60.0' },
    }),
  }
}

// ── Follow-ups and tasks ─────────────────────────────────────────────

const followUpDone: MomentDef = {
  kind: 'followup.done',
  label: 'Follow-up done',
  noun: 'follow-ups done',
  group: 'Follow-ups & tasks',
  props: [AGENT],
  values: [],
  sql: (_p, a) => ({
    from: 'follow_ups f',
    where: `f.account_id = ${a}::uuid AND f.completed_at IS NOT NULL`,
    at: 'f.completed_at',
    contact: 'f.contact_id',
    prop: { agent: 'f.assigned_to::text' },
    value: {},
  }),
}

const taskDone: MomentDef = {
  kind: 'task.done',
  label: 'Task done',
  noun: 'tasks done',
  group: 'Follow-ups & tasks',
  props: [{ key: 'priority', label: 'Priority' }, AGENT],
  values: [],
  sql: (_p, a) => ({
    from: 'tasks t',
    where: `t.account_id = ${a}::uuid AND t.completed_at IS NOT NULL`,
    at: 't.completed_at',
    contact: 't.contact_id',
    prop: { priority: 't.priority', agent: 't.assigned_to::text' },
    value: {},
  }),
}

// ── Payments ─────────────────────────────────────────────────────────

function paymentMoment(kind: string, label: string, noun: string, extraWhere: string, at: string): MomentDef {
  return {
    kind,
    label,
    noun,
    group: 'Payments',
    props: [{ key: 'status', label: 'Status' }],
    values: [{ key: 'amount', label: 'Amount', unit: 'INR' }],
    sql: (_p, a) => ({
      from: 'whatsapp_payments w',
      where: `w.account_id = ${a}::uuid${extraWhere}`,
      at,
      contact: 'w.contact_id',
      prop: { status: 'w.status' },
      value: { amount: 'w.amount' },
    }),
  }
}

export const STATIC_MOMENTS: MomentDef[] = [
  conversationStarted,
  messageMoment('message.customer', 'Customer message', 'customer messages', 'customer', 'c.assigned_agent_id::text'),
  messageMoment('message.agent', 'Team reply', 'team replies', 'agent', 'm.sender_id::text'),
  messageMoment('message.bot', 'Bot or AI reply', 'bot and AI replies', 'bot', 'c.assigned_agent_id::text'),

  leadMoment('lead.created', 'Lead created', 'leads created', '', 'l.created_at'),
  leadMoment('lead.won', 'Lead won', 'leads won', " AND l.status = 'closed' AND l.converted_at IS NOT NULL", 'l.converted_at'),
  leadMoment(
    'lead.lost', 'Lead lost', 'leads lost',
    " AND l.status = 'closed' AND l.converted_at IS NULL AND btrim(coalesce(l.lost_reason, '')) <> ''",
    'coalesce(l.lost_at, l.updated_at)',
    [{ key: 'lost_reason', label: 'Lost reason' }],
    { lost_reason: 'btrim(l.lost_reason)' },
  ),

  callMoment('call.inbound', 'Call received', 'calls received', " AND k.direction = 'inbound'"),
  callMoment('call.missed', 'Call missed', 'missed calls', " AND k.status = 'missed'"),
  callMoment('call.outbound', 'Call made', 'calls made', " AND k.direction = 'outbound'"),

  followUpDone,
  taskDone,

  paymentMoment('payment.requested', 'Payment requested', 'payment requests', '', 'w.created_at'),
  paymentMoment('payment.received', 'Payment received', 'payments received', " AND w.status = 'completed'", 'w.updated_at'),
]

// ── Data Store: each of the account's own tables ─────────────────────

/** Field types a report may split by: a short list of known values, never
 *  free text — a name, a phone number or a note never becomes a group. */
const GROUPABLE = new Set(['select', 'radio', 'district', 'country', 'boolean'])
const MONTHLY = new Set(['date', 'datetime'])

export interface StoreTable {
  id: string
  name: string
  fields: { field_key: string; label: string; field_type: string }[]
}

export function storeMoment(table: StoreTable): MomentDef {
  const groupable = table.fields.filter((f) => GROUPABLE.has(f.field_type))
  const monthly = table.fields.filter((f) => MONTHLY.has(f.field_type))
  const numbers = table.fields.filter((f) => f.field_type === 'number')

  const props: PropDef[] = [
    { key: 'source', label: 'Where it came from' },
    ...groupable.map((f) => ({ key: `f:${f.field_key}`, label: f.label })),
    ...monthly.map((f) => ({ key: `m:${f.field_key}`, label: `${f.label} (month)` })),
  ]
  const values: ValueDef[] = numbers.map((f) => ({ key: `n:${f.field_key}`, label: f.label }))

  return {
    kind: `record:${table.id}`,
    label: `${table.name}: record added`,
    noun: `${table.name} records`,
    group: 'Data Store',
    props,
    values,
    sql: (p, a) => {
      const tableParam = p.add(table.id)
      const prop: Record<string, string> = { source: 'r.source' }
      for (const f of groupable) prop[`f:${f.field_key}`] = `(r.data ->> ${p.add(f.field_key)})`
      for (const f of monthly) {
        const k = p.add(f.field_key)
        // Only values that look like a date are grouped; anything else is
        // left out rather than allowed to fail the whole report.
        prop[`m:${f.field_key}`] = `CASE WHEN (r.data ->> ${k}) ~ '^\\d{4}-\\d{2}' THEN substr(r.data ->> ${k}, 1, 7) END`
      }
      const value: Record<string, string> = {}
      for (const f of numbers) {
        const k = p.add(f.field_key)
        value[`n:${f.field_key}`] = `CASE WHEN (r.data ->> ${k}) ~ '^-?\\d+(\\.\\d+)?$' THEN (r.data ->> ${k})::numeric END`
      }
      return {
        from: 'data_records r',
        where: `r.account_id = ${a}::uuid AND r.table_id = ${tableParam}::uuid`,
        at: 'r.created_at',
        contact: 'r.contact_id',
        prop,
        value,
      }
    },
  }
}

export function findMoment(kind: string, store: StoreTable[]): MomentDef | null {
  const fixed = STATIC_MOMENTS.find((m) => m.kind === kind)
  if (fixed) return fixed
  if (kind.startsWith('record:')) {
    const table = store.find((t) => `record:${t.id}` === kind)
    return table ? storeMoment(table) : null
  }
  return null
}
