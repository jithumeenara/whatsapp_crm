/**
 * Meta Ads helpers — Conversions API for Business Messaging, plus the
 * Marketing API calls needed for Lead Ads sync and the Ads Insights
 * dashboard. Named-parameter functions throughout, same convention as
 * `@/lib/whatsapp/meta-api.ts` (positional args caused real swapped-
 * argument bugs there before that switch).
 *
 * Verified against Meta's own developer documentation this session:
 *   - Conversions API for Business Messaging onboarding guide
 *   - Lead Ads retrieval + webhooks integration guide
 *   - Ads Insights API reference
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    error_user_msg?: string
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    const e = data.error
    if (e) {
      const detail = e.error_user_msg || e.message || fallback
      const code = e.code ? ` (code ${e.code}${e.error_subcode ? `.${e.error_subcode}` : ''})` : ''
      message = `${detail}${code}`
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Dataset (Conversions API for Business Messaging)
// ============================================================

/**
 * Creates (or retrieves, if one already exists) the Conversions API
 * dataset for a WhatsApp Business Account — the container every event
 * sent via `sendBusinessMessagingEvent` is posted into. Meta documents
 * one dataset per Page/WABA, so this is safe to call every time a
 * connection is (re)saved — POST is idempotent server-side per Meta's
 * own docs; a GET fallback covers the case where it isn't.
 */
export async function createOrGetDataset(args: {
  wabaId: string
  accessToken: string
}): Promise<{ datasetId: string }> {
  const { wabaId, accessToken } = args
  const createRes = await fetch(`${META_API_BASE}/${wabaId}/dataset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (createRes.ok) {
    const data = (await createRes.json()) as { id?: string; dataset_id?: string }
    const id = data.id ?? data.dataset_id
    if (id) return { datasetId: id }
  }
  // Fall back to reading back whatever dataset already exists for this WABA.
  const getRes = await fetch(`${META_API_BASE}/${wabaId}/dataset`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!getRes.ok) {
    await throwMetaError(getRes, 'Could not create or retrieve a Conversions API dataset for this WhatsApp Business Account')
  }
  const data = (await getRes.json()) as { data?: { id: string }[]; id?: string }
  const id = data.id ?? data.data?.[0]?.id
  if (!id) throw new Error('Meta did not return a dataset ID')
  return { datasetId: id }
}

// ============================================================
// Conversions API for Business Messaging
// ============================================================

export type BusinessMessagingEventName =
  | 'QualifiedLead' | 'Purchase' | 'LeadSubmitted' | 'InitiateCheckout'
  | 'Schedule' | 'Contact'

export interface SendBusinessMessagingEventArgs {
  datasetId: string
  accessToken: string
  eventName: BusinessMessagingEventName
  /** Unix seconds. */
  eventTime: number
  wabaId: string
  /** The click ID captured from the WhatsApp webhook's referral object —
   *  the whole point of this call: tying a real outcome back to the ad
   *  that started the conversation. */
  ctwaClid?: string | null
  customData?: { currency?: string; value?: number }
}

/**
 * Reports one real outcome (a lead qualifying, a deal closing) back to
 * Meta for a WhatsApp conversation. Silently a no-op from the caller's
 * side if there's no ctwa_clid — Meta has nothing to attribute the event
 * to without it, so sending anyway would just be a wasted call; call
 * sites check for a stored ctwa_clid before calling this at all.
 */
export async function sendBusinessMessagingEvent(args: SendBusinessMessagingEventArgs): Promise<void> {
  const { datasetId, accessToken, eventName, eventTime, wabaId, ctwaClid, customData } = args
  const res = await fetch(`${META_API_BASE}/${datasetId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      data: [{
        event_name: eventName,
        event_time: eventTime,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
          whatsapp_business_account_id: wabaId,
          ...(ctwaClid ? { ctwa_clid: ctwaClid } : {}),
        },
        ...(customData ? { custom_data: customData } : {}),
      }],
    }),
  })
  if (!res.ok) {
    await throwMetaError(res, `Failed to send ${eventName} to Meta Conversions API`)
  }
}

// ============================================================
// Connection test
// ============================================================

/** Lightweight "is this token + WABA valid" probe — mirrors
 *  verifyPhoneNumber's role for the WhatsApp config screen. */
export async function testMetaAdsConnection(args: { wabaId: string; accessToken: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${META_API_BASE}/${args.wabaId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    })
    if (!res.ok) {
      let message = `Meta rejected these credentials (HTTP ${res.status})`
      try {
        const data = (await res.json()) as MetaErrorResponse
        if (data.error?.message) message = data.error.error_user_msg || data.error.message
      } catch { /* keep fallback */ }
      return { ok: false, message }
    }
    const data = (await res.json()) as { name?: string }
    return { ok: true, message: data.name ? `Connected — ${data.name}` : 'Connected' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error contacting Meta' }
  }
}

// ============================================================
// Lead Ads
// ============================================================

export interface LeadFormSummary { id: string; name: string; page_id?: string }

/** Every Instant Form on a Page — the "Get fields"-style list a settings
 *  screen offers so the user just ticks which forms to sync. */
export async function fetchLeadForms(args: { pageId: string; accessToken: string }): Promise<LeadFormSummary[]> {
  const res = await fetch(`${META_API_BASE}/${args.pageId}/leadgen_forms?fields=id,name`, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!res.ok) await throwMetaError(res, 'Failed to fetch Lead Ads forms for this Page')
  const data = (await res.json()) as { data?: LeadFormSummary[] }
  return (data.data ?? []).map((f) => ({ ...f, page_id: args.pageId }))
}

export interface LeadFieldData { name: string; values: string[] }
export interface LeadDetail {
  id: string
  created_time: string
  ad_id?: string
  form_id?: string
  field_data: LeadFieldData[]
}

/** Full answers for one submission — called once per leadgen_id the
 *  webhook notifies us about, per Meta's documented two-step flow
 *  (webhook gives the ID, this fetches the actual data). */
export async function fetchLead(args: { leadId: string; accessToken: string }): Promise<LeadDetail> {
  const res = await fetch(`${META_API_BASE}/${args.leadId}?fields=id,created_time,ad_id,form_id,field_data`, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!res.ok) await throwMetaError(res, 'Failed to fetch lead details from Meta')
  return res.json()
}

/** Pulls a value out of a lead's field_data by Meta's field name — case-
 *  insensitive since forms mix "full_name"/"FULL_NAME" in the wild. */
export function getLeadField(lead: LeadDetail, fieldName: string): string | undefined {
  const match = lead.field_data.find((f) => f.name.toLowerCase() === fieldName.toLowerCase())
  return match?.values?.[0]
}

// ============================================================
// Ads Insights (spend/ROI dashboard)
// ============================================================

export interface AdInsights {
  spend: number
  impressions: number
  clicks: number
  cpc: number | null
  cpm: number | null
  date_start: string
  date_stop: string
}

/** Campaign-level spend for the Ads dashboard — joined against real
 *  Lead/Deal outcomes by the caller, not by this function (Meta's own
 *  "roas" field only knows about Meta Pixel/App events, not this CRM's
 *  pipeline, so real ROI is computed in the dashboard route instead). */
export async function fetchAdAccountInsights(args: {
  adAccountId: string
  accessToken: string
  datePreset?: 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'this_month'
}): Promise<AdInsights | null> {
  const preset = args.datePreset ?? 'last_30d'
  const url = `${META_API_BASE}/${args.adAccountId}/insights?fields=spend,impressions,clicks,cpc,cpm&date_preset=${preset}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${args.accessToken}` } })
  if (!res.ok) await throwMetaError(res, 'Failed to fetch ad account insights from Meta')
  const data = (await res.json()) as { data?: Array<Record<string, string>> }
  const row = data.data?.[0]
  if (!row) return null
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    cpc: row.cpc ? Number(row.cpc) : null,
    cpm: row.cpm ? Number(row.cpm) : null,
    date_start: row.date_start ?? '',
    date_stop: row.date_stop ?? '',
  }
}
