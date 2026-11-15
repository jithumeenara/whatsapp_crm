/**
 * Checking a Meta Ads connection, and saying in plain words what is wrong.
 *
 * Why this exists: Meta answers "Object with ID … does not exist, cannot be
 * loaded due to missing permissions" for four different mistakes (wrong ID,
 * ID of the wrong kind, asset not given to the System User, token made
 * without the permission). The old check showed that sentence as it was, and
 * it also refused to save unless the WhatsApp account could be read, even
 * though the ad reports only need the ad account. Now each asset is checked
 * on its own, the answer names the exact Meta screen to fix, and a working ad
 * account is enough to connect.
 */

import { MARKETING_API_VERSION } from '@/lib/meta/versions'

const BASE = `https://graph.facebook.com/${MARKETING_API_VERSION}`
const TIMEOUT_MS = 10_000

export type MetaAsset = 'token' | 'ad_account' | 'waba'

export interface MetaErrorInfo {
  code?: number
  subcode?: number
  message?: string
  userMessage?: string
}

/** Digits only, optional `act_` — the same shape the reports accept. */
export function cleanAdAccountId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  return /^(act_)?\d{5,30}$/.test(t) ? (t.startsWith('act_') ? t : `act_${t}`) : null
}

export function cleanWabaId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return /^\d{5,30}$/.test(t) ? t : null
}

/** A sentence a business owner can act on. Never a stack or a raw code dump. */
export function explainMetaProblem(asset: MetaAsset, err: MetaErrorInfo, id?: string): string {
  const code = err.code
  const raw = (err.userMessage || err.message || '').trim()
  const lower = raw.toLowerCase()
  const label = asset === 'ad_account' ? `the ad account ${id ?? ''}`.trim() : asset === 'waba' ? `the WhatsApp Business Account ${id ?? ''}`.trim() : 'this token'

  if (code === 190 || lower.includes('access token') && (lower.includes('expired') || lower.includes('invalid') || lower.includes('malformed'))) {
    return 'Meta says this access token is expired or not valid. Make a new System User token in Business Settings → Users → System users → Generate token, and paste it again.'
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'Meta is limiting requests right now. Wait a minute and try again.'
  }
  if (asset === 'token') {
    return raw ? `Meta did not accept this token: ${raw}` : 'Meta did not accept this token.'
  }
  const missingPermission = code === 10 || code === 200 || code === 294 || lower.includes('permission')
  const notVisible = code === 100 || code === 803 || lower.includes('does not exist') || lower.includes('cannot be loaded')
  if (asset === 'ad_account' && (notVisible || missingPermission)) {
    return `This token cannot see ${label}. In Meta Business Settings → Users → System users → your user → Add assets → Ad accounts, give it this account (Manage ad account). Then generate the token again with ads_read and ads_management ticked. Check the number too: it is the ad account ID, not the Business ID.`
  }
  if (asset === 'waba' && (notVisible || missingPermission)) {
    return `This token cannot see ${label}. In Business Settings → System users → your user → Add assets → WhatsApp accounts, give it this account (Full control). Then generate the token again with whatsapp_business_management ticked. Check the number too: it is the WhatsApp Business Account ID, not the phone number ID. Ad reports work without it, so you can leave it empty.`
  }
  return raw ? `Meta said: ${raw}` : `Meta could not check ${label}.`
}

interface Probe {
  ok: boolean
  name?: string
  currency?: string
  message: string
}

async function probe(url: string, token: string, asset: MetaAsset, id?: string): Promise<Probe> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
    const body = (await res.json().catch(() => ({}))) as {
      name?: string
      account_currency?: string
      currency?: string
      error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string }
    }
    if (!res.ok || body.error) {
      return {
        ok: false,
        message: explainMetaProblem(asset, {
          code: body.error?.code,
          subcode: body.error?.error_subcode,
          message: body.error?.message,
          userMessage: body.error?.error_user_msg,
        }, id),
      }
    }
    return { ok: true, name: body.name, currency: body.currency ?? body.account_currency, message: '' }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    console.error('[meta-ads] access probe failed', asset, err)
    return { ok: false, message: timedOut ? 'Meta did not answer in time. Try again in a moment.' : 'Could not reach Meta. Check the server connection and try again.' }
  } finally {
    clearTimeout(timer)
  }
}

export interface AccessResult {
  /** True when the connection can be saved. */
  ok: boolean
  /** Why it cannot be saved (plain words), else null. */
  blocking: string | null
  /** Things that work or do not, to show next to the saved state. */
  adAccount?: { ok: boolean; name?: string; currency?: string; message: string }
  waba?: { ok: boolean; name?: string; message: string }
  /** A short line for the green state, or the non-blocking caution. */
  message: string
}

/**
 * Token first, then each asset the user gave, side by side.
 * Rules: a bad token or a bad ad account blocks; a bad WhatsApp account
 * blocks only when there is no working ad account to fall back on.
 */
export async function checkMetaAdsAccess(args: {
  accessToken: string
  adAccountId: string | null
  wabaId: string | null
}): Promise<AccessResult> {
  const { accessToken, adAccountId, wabaId } = args
  if (!adAccountId && !wabaId) {
    return { ok: false, blocking: 'Add your ad account ID (it starts with act_ or is just digits). It is in Ads Manager, next to the account name.', message: '' }
  }

  const [me, ad, waba] = await Promise.all([
    probe(`${BASE}/me?fields=id,name`, accessToken, 'token'),
    adAccountId ? probe(`${BASE}/${adAccountId}?fields=id,name,currency`, accessToken, 'ad_account', adAccountId) : Promise.resolve(null),
    wabaId ? probe(`${BASE}/${wabaId}?fields=id,name`, accessToken, 'waba', wabaId) : Promise.resolve(null),
  ])

  // A token Meta rejects makes every other answer meaningless; say that once.
  if (!me.ok) {
    // /me can fail for permission reasons on a token that still reads assets,
    // so only a real token error stops here.
    const tokenDead = [ad, waba].every((p) => !p || !p.ok)
    if (tokenDead) return { ok: false, blocking: me.message, message: '' }
  }

  if (ad && !ad.ok) return { ok: false, blocking: ad.message, adAccount: ad, waba: waba ?? undefined, message: '' }
  if (waba && !waba.ok && !(ad && ad.ok)) return { ok: false, blocking: waba.message, waba, message: '' }

  const parts: string[] = []
  if (ad?.ok) parts.push(`ad account ${ad.name ? `“${ad.name}”` : adAccountId}${ad.currency ? ` (${ad.currency})` : ''}`)
  if (waba?.ok) parts.push(`WhatsApp account ${waba.name ? `“${waba.name}”` : wabaId}`)
  const caution = waba && !waba.ok ? ` The WhatsApp account was not saved: ${waba.message}` : ''
  return {
    ok: true,
    blocking: null,
    adAccount: ad ?? undefined,
    waba: waba ?? undefined,
    message: `Connected — ${parts.join(' and ')}.${caution}`,
  }
}
