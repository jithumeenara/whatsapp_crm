/**
 * Live health of each connected WhatsApp number, for the numbers overview
 * (Settings → Channels → WhatsApp). docs/plans/whatsapp-multi-number-coexistence-plan.md.
 *
 * Read from Meta with that number's own token: display number and name,
 * the name review, quality (GREEN / YELLOW / RED), throughput level,
 * whether it is a WhatsApp Business app number (coexistence, 20 messages a
 * second) and the business portfolio's shared messaging limit — since
 * Oct 2025 one limit for every number in the portfolio, so more numbers do
 * not mean more sends (Meta deprecated messaging_limit_tier).
 *
 * Cached 5 minutes per number. Never returns a token.
 */

import { META_API_BASE } from '@/lib/whatsapp/meta-api'

export interface NumberHealth {
  display_phone_number: string | null
  verified_name: string | null
  name_status: string | null
  quality_rating: string | null
  throughput: string | null
  platform_type: string | null
  is_on_biz_app: boolean
  code_verification_status: string | null
  messaging_limit: string | null
  error: string | null
}

const FULL = 'display_phone_number,verified_name,name_status,quality_rating,throughput,platform_type,is_on_biz_app,code_verification_status,whatsapp_business_manager_messaging_limit'
// Fields every Graph version has: used when Meta refuses one of the newer ones.
const SAFE = 'display_phone_number,verified_name,quality_rating,code_verification_status'

const TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; value: NumberHealth }>()

const s = (v: unknown, max = 80): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null)

/** Meta returns throughput as { level } and the limit as a string or { current_limit }. */
export function toHealth(d: Record<string, unknown>): NumberHealth {
  const tp = d.throughput
  const lim = d.whatsapp_business_manager_messaging_limit
  return {
    display_phone_number: s(d.display_phone_number, 40),
    verified_name: s(d.verified_name, 120),
    name_status: s(d.name_status, 40),
    quality_rating: s(d.quality_rating, 20),
    throughput: s(tp && typeof tp === 'object' ? (tp as { level?: unknown }).level : tp, 40),
    platform_type: s(d.platform_type, 40),
    is_on_biz_app: d.is_on_biz_app === true,
    code_verification_status: s(d.code_verification_status, 40),
    messaging_limit: s(lim && typeof lim === 'object' ? (lim as { current_limit?: unknown }).current_limit : lim, 40),
    error: null,
  }
}

async function fetchFields(phoneNumberId: string, token: string, fields: string) {
  const res = await fetch(`${META_API_BASE}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: number; message?: string } }
  return { ok: res.ok && !data.error, data, code: data.error?.code }
}

export async function numberHealth(phoneNumberId: string, token: string, opts: { fresh?: boolean } = {}): Promise<NumberHealth> {
  const hit = cache.get(phoneNumberId)
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value: NumberHealth
  try {
    let r = await fetchFields(phoneNumberId, token, FULL)
    // 100 = a field this version or token does not know: fall back to the basics.
    if (!r.ok && r.code === 100) r = await fetchFields(phoneNumberId, token, SAFE)
    if (r.ok) value = toHealth(r.data)
    else {
      console.warn('[number-health]', phoneNumberId, 'Meta code', r.code ?? 'none')
      value = { ...toHealth({}), error: r.code === 190 ? 'token' : 'meta' }
    }
  } catch (err) {
    console.warn('[number-health]', phoneNumberId, err instanceof Error ? err.message : err)
    value = { ...toHealth({}), error: 'network' }
  }
  cache.set(phoneNumberId, { at: Date.now(), value })
  return value
}
