/**
 * Which Meta account a token belongs to — read from Meta, never typed.
 *
 * Instagram (Meta, Nov 2026):
 *  - Instagram Login token (IGAA…): GET graph.instagram.com/me?fields=user_id.
 *    `user_id` is the professional account id that webhooks carry as
 *    entry.id; `id` is only app-scoped and must not be stored.
 *  - Unified Login / System User token (EAA…): `/me` is the system user;
 *    the Instagram accounts come from /me/assigned_instagram_accounts.
 *  - Page token (EAA…): `/me` is the Page; its linked account is
 *    instagram_business_account.
 * Messenger: the token must belong to the Page saved for this workspace.
 * A System User / user token is turned into that Page's own token (the Send
 * API wants a Page token).
 */

import { MESSAGING_GRAPH_VERSION, isFacebookToken } from './social-messaging'

const V = MESSAGING_GRAPH_VERSION
const FB = `https://graph.facebook.com/${V}`
const IG = `https://graph.instagram.com/${V}`
const NUMERIC_ID = /^\d{1,30}$/

type MetaError = { message?: string; code?: number; error_subcode?: number }
async function getJson<T>(url: string, token: string): Promise<{ ok: true; data: T } | { ok: false; error: MetaError; status: number }> {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })
  const data = (await res.json().catch(() => ({}))) as T & { error?: MetaError }
  if (!res.ok || (data as { error?: MetaError }).error) return { ok: false, error: (data as { error?: MetaError }).error ?? {}, status: res.status }
  return { ok: true, data }
}

function plain(error: MetaError, fallback: string): string {
  if (error.code === 190) return 'This token is not valid any more (expired, revoked or copied incompletely). Create a new one, or reconnect.'
  if (error.code === 10 || error.code === 200) return `Meta refused: ${error.message ?? 'a permission is missing'}.`
  return error.message ? `${fallback} Meta said: ${error.message}` : fallback
}

export type InstagramIdentity =
  | { ok: true; igAccountId: string; username: string | null; name: string | null; tokenKind: 'instagram_login' | 'system_user' | 'page'; pageId: string | null; others: number }
  | { ok: false; error: string }

/** `preferId`: the account already saved, chosen when the token sees several. */
export async function identifyInstagramToken(token: string, preferId?: string | null): Promise<InstagramIdentity> {
  const t = token.trim()
  if (!t) return { ok: false, error: 'No token.' }

  if (!isFacebookToken(t)) {
    const me = await getJson<{ user_id?: string | number; id?: string; username?: string; name?: string }>(`${IG}/me?fields=user_id,username,name`, t)
    if (!me.ok) return { ok: false, error: plain(me.error, 'Instagram did not accept this token.') }
    const id = me.data.user_id != null ? String(me.data.user_id) : null
    if (!id || !NUMERIC_ID.test(id)) return { ok: false, error: 'Instagram did not return the professional account id for this token.' }
    return { ok: true, igAccountId: id, username: me.data.username ?? null, name: me.data.name ?? null, tokenKind: 'instagram_login', pageId: null, others: 0 }
  }

  // System User / Unified Login token: the accounts shared with it.
  const assigned = await getJson<{ data?: Array<{ id?: string; username?: string; name?: string }> }>(`${FB}/me/assigned_instagram_accounts?fields=id,username,name`, t)
  if (assigned.ok && Array.isArray(assigned.data.data) && assigned.data.data.length > 0) {
    const list = assigned.data.data.filter((a) => a.id && NUMERIC_ID.test(a.id))
    const pick = list.find((a) => a.id === preferId) ?? list[0]
    if (pick?.id) return { ok: true, igAccountId: pick.id, username: pick.username ?? null, name: pick.name ?? null, tokenKind: 'system_user', pageId: null, others: list.length - 1 }
  }

  // Page token: the account linked to the Page.
  const page = await getJson<{ id?: string; name?: string; instagram_business_account?: { id?: string; username?: string; name?: string } }>(
    `${FB}/me?fields=id,name,instagram_business_account{id,username,name}`, t)
  if (!page.ok) return { ok: false, error: plain(page.error, 'Meta did not accept this token.') }
  const igba = page.data.instagram_business_account
  if (igba?.id && NUMERIC_ID.test(igba.id)) {
    return { ok: true, igAccountId: igba.id, username: igba.username ?? null, name: igba.name ?? page.data.name ?? null, tokenKind: 'page', pageId: page.data.id && NUMERIC_ID.test(page.data.id) ? page.data.id : null, others: 0 }
  }
  return { ok: false, error: 'This token cannot see an Instagram professional account. Share the Instagram account with the app (or link it to the Facebook Page), then try again.' }
}

export type PageIdentity =
  | { ok: true; pageId: string; pageName: string | null; pageToken: string; tokenKind: 'page' | 'system_user' }
  | { ok: false; error: string }

/** `expectPageId`: the Page saved for this workspace; a token for another Page is refused. */
export async function identifyPageToken(token: string, expectPageId?: string | null): Promise<PageIdentity> {
  const t = token.trim()
  if (!t || !isFacebookToken(t)) return { ok: false, error: 'A Messenger token starts with EAA. Paste a Page token or a System User token.' }
  const want = expectPageId && NUMERIC_ID.test(expectPageId) ? expectPageId : null

  const me = await getJson<{ id?: string; name?: string; category?: string }>(`${FB}/me?fields=id,name,category`, t)
  if (!me.ok) return { ok: false, error: plain(me.error, 'Meta did not accept this token.') }

  // A Page token: /me is the Page (Pages have a category).
  if (me.data.category && me.data.id && NUMERIC_ID.test(me.data.id)) {
    if (want && me.data.id !== want) return { ok: false, error: `This token belongs to another Page (${me.data.name ?? me.data.id}), not the one saved here.` }
    return { ok: true, pageId: me.data.id, pageName: me.data.name ?? null, pageToken: t, tokenKind: 'page' }
  }

  // A System User / user token: find the Page and use its own token.
  const pages = await getJson<{ data?: Array<{ id?: string; name?: string; access_token?: string }> }>(`${FB}/me/accounts?fields=id,name,access_token`, t)
  if (!pages.ok) return { ok: false, error: plain(pages.error, 'Meta did not list any Pages for this token.') }
  const list = (pages.data.data ?? []).filter((p) => p.id && NUMERIC_ID.test(p.id) && p.access_token)
  const pick = want ? list.find((p) => p.id === want) : list.length === 1 ? list[0] : undefined
  if (!pick) {
    return { ok: false, error: list.length === 0
      ? 'This token cannot see any Facebook Page. Give it access to the Page, then try again.'
      : 'This token can see several Pages. Enter the Page ID to choose one.' }
  }
  return { ok: true, pageId: pick.id as string, pageName: pick.name ?? null, pageToken: pick.access_token as string, tokenKind: 'system_user' }
}
