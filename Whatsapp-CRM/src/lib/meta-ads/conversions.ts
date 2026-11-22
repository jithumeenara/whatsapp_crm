/**
 * Results sent back to Meta — one pipeline for every channel.
 *
 * When a lead qualifies, wins or is lost (or a Lead Ads lead arrives), the
 * result is written to conversion_events (outbox + send log) and sent at
 * once; failures are retried with back-off by a minute job. Two targets:
 *
 *  - Conversions API for Business Messaging (`business_messaging`): a chat
 *    that came from an ad. WhatsApp / Instagram use the stored ctwa_clid on
 *    the WABA dataset; Messenger uses the Page-scoped id on the Page's own
 *    dataset (created on first use). QualifiedLead and Purchase only —
 *    Meta's Automatic Events already report the first message (LeadSubmitted).
 *  - Conversions API for CRM (`crm`, "Conversion Leads"): a lead from a Lead
 *    Ads form, matched on Meta's lead id; every stage (Lead → Qualified →
 *    Converted / Lost) under the names the business set, to the Lead Ads
 *    dataset it chose.
 *
 * Only Meta ids are stored (ctwa_clid, Page-scoped id, Lead Ads lead id) —
 * no phone numbers, names or tokens. (account_id, event_id) is unique, so a
 * repeat (double click, reopen + close) is never queued twice, and the
 * event_id makes Meta count it once. Never throws: a report must not break
 * the save that caused it. Free of next/server (runs in the minute job).
 */

import { prisma } from '@/lib/db'
import { decrypt, openStoredSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { sendBusinessMessagingEvent, type BusinessMessagingEventName } from './api'
import { outcomeEventId } from './triggers'

export type ConversionStage = 'raw' | 'qualified' | 'won' | 'lost'
export const DEFAULT_STAGE_NAMES: Record<ConversionStage, string> = { raw: 'Lead', qualified: 'Qualified', won: 'Converted', lost: 'Lost' }

const BM_EVENT: Partial<Record<ConversionStage, BusinessMessagingEventName>> = { qualified: 'QualifiedLead', won: 'Purchase' }
const MAX_ATTEMPTS = 6
const BACKOFF_MIN = [1, 5, 30, 120, 720]
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const ID = /^\d{1,30}$/

type Payload = { ctwa_clid?: string; psid?: string; lead_id?: string; value?: number; currency?: string }
type Row = { id: string; account_id: string; target: string; channel: string | null; stage: string; event_name: string; event_id: string; payload: unknown; attempts: number }

export function stageNames(raw: unknown): Record<ConversionStage, string> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: ConversionStage) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, 50) : DEFAULT_STAGE_NAMES[k])
  return { raw: pick('raw'), qualified: pick('qualified'), won: pick('won'), lost: pick('lost') }
}

function money(value: number | undefined, currency: string | undefined): Pick<Payload, 'value' | 'currency'> {
  const out: Pick<Payload, 'value' | 'currency'> = {}
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out.value = Math.round(value * 100) / 100
  if (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)) out.currency = currency
  return out
}

/**
 * Queue and send what this result means for Meta. `leadId` links Lead Ads
 * stages; `dealId` (a won deal) names the record when there is one.
 */
export async function reportConversion(input: {
  accountId: string
  stage: ConversionStage
  contactId?: string | null
  leadId?: string | null
  dealId?: string | null
  value?: number
  currency?: string
}): Promise<void> {
  try {
    const settings = await prisma.conversionSettings.findUnique({ where: { account_id: input.accountId } })
    if (settings && !settings.enabled) return
    const record = input.dealId ? { kind: 'deal' as const, id: input.dealId } : input.leadId ? { kind: 'lead' as const, id: input.leadId } : null
    if (!record) return
    const extra = money(input.value, input.currency)
    const rows: Array<{ target: string; channel: string | null; event_name: string; event_id: string; payload: Payload }> = []

    const bmEvent = BM_EVENT[input.stage]
    if (bmEvent && input.contactId) {
      const conv = await prisma.conversation.findFirst({
        where: { account_id: input.accountId, contact_id: input.contactId, channel: { in: ['whatsapp', 'instagram'] }, ctwa_clid: { not: null } },
        orderBy: { created_at: 'desc' },
        select: { ctwa_clid: true, channel: true },
      })
      // Same event_id as the older direct path, so Meta merges the two.
      const eventId = outcomeEventId(bmEvent, record.kind, record.id)
      if (conv?.ctwa_clid) {
        rows.push({ target: 'business_messaging', channel: conv.channel === 'instagram' ? 'instagram' : 'whatsapp', event_name: bmEvent, event_id: eventId, payload: { ctwa_clid: conv.ctwa_clid.slice(0, 200), ...extra } })
      } else {
        const touch = await prisma.adTouch.findFirst({ where: { account_id: input.accountId, contact_id: input.contactId, channel: 'facebook' }, select: { id: true } })
        if (touch) {
          const contact = await prisma.contact.findFirst({ where: { id: input.contactId, account_id: input.accountId }, select: { facebook_id: true } })
          if (contact?.facebook_id && ID.test(contact.facebook_id)) {
            rows.push({ target: 'business_messaging', channel: 'messenger', event_name: bmEvent, event_id: eventId, payload: { psid: contact.facebook_id, ...extra } })
          }
        }
      }
    }

    const leadId = input.leadId ?? (input.dealId ? (await prisma.deal.findFirst({ where: { id: input.dealId, account_id: input.accountId }, select: { lead_id: true } }))?.lead_id ?? null : null)
    if (leadId) {
      const sub = await prisma.leadAdSubmission.findFirst({ where: { account_id: input.accountId, lead_id: leadId }, select: { meta_leadgen_id: true } })
      if (sub?.meta_leadgen_id && /^\d{10,20}$/.test(sub.meta_leadgen_id)) {
        const names = stageNames(settings?.stage_names)
        rows.push({ target: 'crm', channel: null, event_name: names[input.stage], event_id: `crm:${input.stage}:lead:${leadId}`, payload: { lead_id: sub.meta_leadgen_id, ...(input.stage === 'won' ? extra : {}) } })
      }
    }
    if (rows.length === 0) return

    await prisma.conversionEvent.createMany({
      data: rows.map((r) => ({ account_id: input.accountId, target: r.target, channel: r.channel, stage: input.stage, event_name: r.event_name, event_id: r.event_id, record_kind: record.kind, record_id: record.id, payload: r.payload })),
      skipDuplicates: true,
    })
    const fresh = await prisma.conversionEvent.findMany({
      where: { account_id: input.accountId, event_id: { in: rows.map((r) => r.event_id) }, status: 'pending' },
      select: { id: true, account_id: true, target: true, channel: true, stage: true, event_name: true, event_id: true, payload: true, attempts: true },
    })
    for (const row of fresh) await processConversion(row)
  } catch (err) {
    console.error('[conversions] could not queue a result (non-fatal):', err instanceof Error ? err.message : err)
  }
}

// ── Sending ──────────────────────────────────────────────────────────────

type SendResult = { ok: true } | { ok: false; error: string; retry: boolean; skip?: boolean }

function explain(code: number | undefined, status: number): { error: string; retry: boolean } {
  if (code === 190) return { error: 'The connection expired — reconnect it in Settings.', retry: false }
  if (code === 10 || code === 200 || code === 3) return { error: 'Meta did not allow it — the app needs the events permission (and Advanced Access for other businesses).', retry: false }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status >= 500 || status === 0) return { error: 'Meta was busy — will try again.', retry: true }
  return { error: 'Meta refused the event — check the connection in Settings.', retry: false }
}

async function postEvents(datasetId: string, token: string, event: Record<string, unknown>): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/${datasetId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: [event] }),
  }).catch(() => null)
  if (res?.ok) return { ok: true }
  const body = (await res?.json().catch(() => ({})) ?? {}) as { error?: { code?: number; message?: string } }
  console.warn('[conversions] Meta refused an event:', res?.status ?? 0, body.error?.code, body.error?.message)
  return { ok: false, ...explain(body.error?.code, res?.status ?? 0) }
}

async function whatsappToken(accountId: string, wabaId: string | null, fallback: string): Promise<string> {
  if (wabaId) {
    const wa = await prisma.whatsAppConfig.findFirst({ where: { account_id: accountId, waba_id: wabaId, status: 'connected' }, select: { access_token: true } }).catch(() => null)
    if (wa?.access_token) { try { return decrypt(wa.access_token) } catch { /* fall back */ } }
  }
  return fallback
}

async function messengerDataset(accountId: string, pageId: string, pageToken: string): Promise<string | null> {
  const s = await prisma.conversionSettings.findUnique({ where: { account_id: accountId }, select: { datasets: true } })
  const known = ((s?.datasets ?? {}) as Record<string, unknown>)[`page:${pageId}`]
  if (typeof known === 'string' && ID.test(known)) return known
  const res = await fetch(`${GRAPH}/${pageId}/dataset`, { method: 'POST', headers: { Authorization: `Bearer ${pageToken}` } }).catch(() => null)
  const body = (await res?.json().catch(() => ({})) ?? {}) as { id?: string; error?: { code?: number; message?: string } }
  if (!res?.ok || !body.id || !ID.test(body.id)) {
    console.warn('[conversions] Messenger dataset not created:', res?.status ?? 0, body.error?.code, body.error?.message)
    return null
  }
  const datasets = { ...((s?.datasets ?? {}) as Record<string, string>), [`page:${pageId}`]: body.id } as Record<string, string>
  await prisma.conversionSettings.upsert({ where: { account_id: accountId }, create: { account_id: accountId, datasets }, update: { datasets } })
  return body.id
}

async function sendConversion(row: Row): Promise<SendResult> {
  const p = (row.payload ?? {}) as Payload
  const custom = { ...(p.value !== undefined ? { value: p.value } : {}), ...(p.currency ? { currency: p.currency } : {}) }
  const eventTime = Math.floor(Date.now() / 1000)

  if (row.target === 'crm') {
    const s = await prisma.conversionSettings.findUnique({ where: { account_id: row.account_id }, select: { crm_dataset_id: true } })
    if (!s?.crm_dataset_id) return { ok: false, error: 'Add the Lead Ads dataset ID in Settings → Ads to send Lead Ads stages.', retry: false, skip: true }
    const ads = await prisma.metaAdsConfig.findUnique({ where: { account_id: row.account_id }, select: { access_token: true } })
    if (!ads?.access_token) return { ok: false, error: 'Connect Ads first.', retry: false, skip: true }
    if (!p.lead_id) return { ok: false, error: 'No Lead Ads lead id.', retry: false, skip: true }
    return postEvents(s.crm_dataset_id, decrypt(ads.access_token), {
      event_name: row.event_name, event_time: eventTime, event_id: row.event_id, action_source: 'system_generated',
      user_data: { lead_id: p.lead_id },
      custom_data: { event_source: 'crm', lead_event_source: 'Lead Magnet CRM', ...custom },
    })
  }

  if (row.channel === 'messenger') {
    const rows = await prisma.$queryRaw<{ page_id: string | null; access_token: string | null }[]>`
      SELECT page_id, access_token FROM facebook_config WHERE account_id = ${row.account_id}::uuid AND status = 'connected' LIMIT 1`.catch(() => [])
    const pageId = rows[0]?.page_id ?? null
    const token = openStoredSecret(rows[0]?.access_token ?? null)
    if (!pageId || !ID.test(pageId) || !token) return { ok: false, error: 'Connect Messenger first.', retry: false, skip: true }
    if (!p.psid) return { ok: false, error: 'No Messenger id for this contact.', retry: false, skip: true }
    const dataset = await messengerDataset(row.account_id, pageId, token)
    if (!dataset) return { ok: false, error: 'Messenger results need the page_events permission — add it to the Messenger configuration and reconnect.', retry: false }
    return postEvents(dataset, token, {
      event_name: row.event_name, event_time: eventTime, event_id: row.event_id, action_source: 'business_messaging', messaging_channel: 'messenger',
      user_data: { page_id: pageId, page_scoped_user_id: p.psid }, ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    })
  }

  // WhatsApp / Instagram: the WABA's dataset (made at WhatsApp Quick Connect).
  const cfg = await prisma.metaAdsConfig.findUnique({ where: { account_id: row.account_id }, select: { dataset_id: true, waba_id: true, access_token: true } })
  if (!cfg?.dataset_id) return { ok: false, error: 'Connect WhatsApp with Quick Connect so the results dataset is created.', retry: false, skip: true }
  if (!p.ctwa_clid) return { ok: false, error: 'No ad click id for this chat.', retry: false, skip: true }
  let pageId: string | undefined
  if (row.channel === 'instagram') {
    const ig = await prisma.$queryRaw<{ page_id: string | null }[]>`SELECT page_id FROM instagram_config WHERE account_id = ${row.account_id}::uuid LIMIT 1`.catch(() => [])
    pageId = ig[0]?.page_id ?? undefined
    if (!pageId) return { ok: false, error: 'Instagram results need the Instagram account linked to a Facebook Page.', retry: false, skip: true }
  }
  const token = await whatsappToken(row.account_id, cfg.waba_id || null, decrypt(cfg.access_token))
  try {
    await sendBusinessMessagingEvent({
      datasetId: cfg.dataset_id, accessToken: token, eventName: row.event_name as BusinessMessagingEventName, eventTime,
      channel: row.channel === 'instagram' ? 'instagram' : 'whatsapp', wabaId: row.channel === 'instagram' ? undefined : cfg.waba_id,
      pageId, ctwaClid: p.ctwa_clid, customData: Object.keys(custom).length ? custom : undefined, eventId: row.event_id,
    })
    return { ok: true }
  } catch (err) {
    console.warn('[conversions] WhatsApp/Instagram event failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Meta refused the event — check the WhatsApp connection in Settings.', retry: true }
  }
}

/** Claim one due row (never sent twice), send it, record the outcome. */
export async function processConversion(row: Row): Promise<void> {
  const claimed = await prisma.conversionEvent.updateMany({
    where: { id: row.id, account_id: row.account_id, status: 'pending', next_attempt_at: { lte: new Date() } },
    data: { status: 'sending', attempts: { increment: 1 }, updated_at: new Date() },
  })
  if (claimed.count !== 1) return
  const attempts = row.attempts + 1
  let result: SendResult
  try { result = await sendConversion(row) } catch (err) {
    console.error('[conversions] send crashed:', err instanceof Error ? err.message : err)
    result = { ok: false, error: 'Could not send — will try again.', retry: true }
  }
  const now = new Date()
  if (result.ok) {
    await prisma.conversionEvent.updateMany({ where: { id: row.id, account_id: row.account_id }, data: { status: 'sent', sent_at: now, last_error: null, updated_at: now } })
  } else if (result.skip) {
    await prisma.conversionEvent.updateMany({ where: { id: row.id, account_id: row.account_id }, data: { status: 'skipped', last_error: result.error, updated_at: now } })
  } else if (result.retry && attempts < MAX_ATTEMPTS) {
    const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000
    await prisma.conversionEvent.updateMany({ where: { id: row.id, account_id: row.account_id }, data: { status: 'pending', next_attempt_at: new Date(now.getTime() + wait), last_error: result.error, updated_at: now } })
  } else {
    await prisma.conversionEvent.updateMany({ where: { id: row.id, account_id: row.account_id }, data: { status: 'failed', last_error: result.error, updated_at: now } })
  }
}

/** Minute job: rows stuck mid-send go back to pending; due rows are sent. */
export async function sendDueConversions(limit = 25): Promise<number> {
  await prisma.conversionEvent.updateMany({
    where: { status: 'sending', updated_at: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: 'pending' },
  })
  const due = await prisma.conversionEvent.findMany({
    where: { status: 'pending', next_attempt_at: { lte: new Date() } },
    orderBy: { created_at: 'asc' },
    take: limit,
    select: { id: true, account_id: true, target: true, channel: true, stage: true, event_name: true, event_id: true, payload: true, attempts: true },
  })
  for (const row of due) await processConversion(row)
  return due.length
}
