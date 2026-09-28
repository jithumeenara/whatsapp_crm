/**
 * Everything that follows a new Data Store row, in one place.
 *
 * Rows arrive through nine doors — staff, the API, an Excel import, the
 * assistant on WhatsApp, a chatbot step, a WhatsApp Flow, the public web
 * form, a payment, an integration. Only the first two ever fired the
 * `record.created` webhook, so a Zapier hook "on every new registration"
 * never heard about the registrations that mattered most: the ones
 * customers made themselves. Every writer now calls `afterRecordCreated`
 * and gets the same treatment.
 *
 * Bulk arrivals (import, integration sync) are left out of both the
 * webhook and the alert, as before: two thousand webhook calls for one
 * spreadsheet is a denial of service on whoever receives them, and an
 * integration echoing its own rows back to itself is a loop.
 *
 * Never throws and never delays the caller — the row is already saved,
 * and a customer waiting on a WhatsApp reply must not wait on an email.
 */

import { prisma } from '@/lib/db'
import { scheduleKnowledgeRefresh } from '@/lib/ai/knowledge-refresh'
import { dispatchWebhooks } from '@/lib/webhooks/deliver'
import { sendPushToUser } from '@/lib/push'
import { sendStaffAlert } from '@/lib/whatsapp/staff-alert'
import { sendEmail } from '@/lib/messaging/channels/email'
import { ALERTABLE_SOURCES, isRecordSource, sourceLabel, type RecordSource } from './sources'
import { parseAlertConfig, wantsSource, matchesCondition, summarizeRecord } from './record-alert'

export interface CreatedRecord {
  id: string
  table_id: string
  account_id: string
  data: unknown
  contact_id?: string | null
  source: RecordSource
  created_at: Date
  updated_at: Date
}

/** Per table. A form someone is hammering, or a chatbot stuck in a loop,
 *  must not become a flood of WhatsApp template sends — each one is
 *  billed to the business by Meta. Past this the rows are still saved;
 *  only the alerts stop, and the log says so. */
const ALERT_LIMIT = { limit: 20, windowMs: 10 * 60_000 }

// Counted here rather than through lib/rate-limit: that module imports
// next/server, and this one is loaded by server.ts (through the chatbot
// engine and the scheduled-message sweep) before Next has set up its
// runtime — importing it there stops the whole server from starting.
const recentAlerts = new Map<string, number[]>()

function allowAlert(tableId: string): boolean {
  const now = Date.now()
  const recent = (recentAlerts.get(tableId) ?? []).filter((t) => now - t < ALERT_LIMIT.windowMs)
  const allowed = recent.length < ALERT_LIMIT.limit
  if (allowed) recent.push(now)
  recentAlerts.set(tableId, recent)
  return allowed
}

export function afterRecordCreated(record: CreatedRecord): void {
  // A connected table's knowledge is brought up to date within a minute.
  scheduleKnowledgeRefresh(record.account_id, record.table_id)
  void (async () => {
    try {
      const table = await prisma.dataTable.findUnique({
        where: { id: record.table_id },
        select: {
          id: true,
          name: true,
          account_id: true,
          alert_config: true,
          fields: {
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            select: { field_key: true, label: true, field_type: true },
          },
        },
      })
      // The row and its table must belong to the same account; anything
      // else is a bug upstream, and nothing is sent anywhere because of it.
      if (!table || table.account_id !== record.account_id) return
      if (!isRecordSource(record.source) || !ALERTABLE_SOURCES.includes(record.source)) return

      const data =
        record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {}

      dispatchWebhooks(
        record.account_id,
        'record.created',
        table.id,
        {
          id: record.id,
          data,
          created_at: record.created_at.toISOString(),
          updated_at: record.updated_at.toISOString(),
        },
        table.name,
      )

      await sendRecordAlert({
        table,
        record,
        data,
      })
    } catch (err) {
      console.error('[data-store] after-create failed:', err instanceof Error ? err.message : err)
    }
  })()
}

async function sendRecordAlert({
  table,
  record,
  data,
}: {
  table: {
    id: string
    name: string
    account_id: string
    alert_config: unknown
    fields: Array<{ field_key: string; label: string; field_type: string }>
  }
  record: CreatedRecord
  data: Record<string, unknown>
}): Promise<void> {
  const config = parseAlertConfig(
    table.alert_config,
    table.fields.map((f) => f.field_key),
  )
  if (!config.enabled) return
  if (!wantsSource(config, record.source)) return
  if (!matchesCondition(config.condition, data)) return
  const hasChannel =
    config.push_user_ids.length > 0 || config.emails.length > 0 || config.whatsapp_numbers.length > 0
  if (!hasChannel) return

  if (!allowAlert(table.id)) {
    console.warn(`[record-alert] ${table.id}: more than ${ALERT_LIMIT.limit} in 10 minutes — alerts paused, rows still saved`)
    return
  }

  const contact = record.contact_id
    ? await prisma.contact.findFirst({
        where: { id: record.contact_id, account_id: record.account_id },
        select: { name: true, phone: true },
      })
    : null

  const lines = summarizeRecord(table.fields, data)
  const via = sourceLabel(record.source)
  const who = contact ? `${contact.name?.trim() || 'Customer'} · ${contact.phone}` : null
  const detail = lines.map((l) => `${l.label}: ${l.value}`)
  const oneLine = lines.slice(0, 3).map((l) => `${l.label}: ${l.value}`).join(' · ') || 'No details'

  // In the app. Only to people who are still members of this account —
  // somebody removed since the setting was saved gets nothing.
  if (config.push_user_ids.length > 0) {
    const members = await prisma.profile.findMany({
      where: { account_id: record.account_id, user_id: { in: config.push_user_ids } },
      select: { user_id: true },
    })
    await Promise.allSettled(
      members.map((m) =>
        sendPushToUser(m.user_id, {
          title: `New in ${table.name}`,
          body: [oneLine, `via ${via}`].join('\n'),
          tag: `data-record-${table.id}`,
          data: { type: 'data_record', tableId: table.id },
        }),
      ),
    )
  }

  if (config.emails.length > 0) {
    const text = [
      `A new record was added to "${table.name}".`,
      '',
      ...detail,
      '',
      `Came in via: ${via}`,
      ...(who ? [`Customer: ${who}`] : []),
      '',
      'Open the Data Store to see the full record. Sensitive fields are masked in this email.',
    ].join('\n')
    await sendEmail({
      accountId: record.account_id,
      to: config.emails,
      subject: `New record: ${table.name}`.replace(/[\r\n]+/g, ' ').slice(0, 150),
      text,
      kind: 'new',
    }).catch((err) => {
      console.error('[record-alert] email failed:', err instanceof Error ? err.message : err)
    })
  }

  if (config.whatsapp_numbers.length > 0) {
    await sendStaffAlert({
      accountId: record.account_id,
      numbers: config.whatsapp_numbers,
      template: config.whatsapp_template,
      templateParams: [table.name, oneLine, via],
      label: 'record-alert',
      text: [
        `🗂️ New record in ${table.name}`,
        '',
        ...detail,
        '',
        `Via: ${via}`,
        ...(who ? [`Customer: ${who}`] : []),
      ].join('\n'),
    })
  }
}
