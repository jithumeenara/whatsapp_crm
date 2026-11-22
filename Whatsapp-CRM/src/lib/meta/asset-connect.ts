/**
 * "Connect Ads" and "Connect Catalog" — the server side.
 *
 * One Facebook Login for Business per asset kind (its own configuration),
 * which returns a Business Integration System User token. We read which ad
 * accounts / catalogs the business shared (debug_token granular scopes,
 * then documented fallbacks), validate each id with the token, and save one
 * row per asset — several per workspace, one default. The default is
 * mirrored into the older single-row tables (meta_ads_config /
 * catalog_config) so every existing report and sender keeps working.
 *
 * Every Graph call carries appsecret_proof; ids are digits only; tokens are
 * sealed before they touch the database and never leave the server; Meta's
 * own error text stays in the server log.
 *
 * Free of next/server so jobs may import it.
 */

import { prisma } from '@/lib/db'
import { encrypt, openStoredSecret, sealSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from './versions'
import { appSecretProof, type AssetKind } from './connect-state'
import type { MetaApp } from './social-connect'

const FB = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const ID = /^\d{1,30}$/
export const MAX_ASSETS = 50

type Json = Record<string, unknown>
type MetaError = { message?: string; code?: number; error_subcode?: number }

async function graph(path: string, token: string, app: MetaApp, params: Record<string, string> = {}): Promise<{ ok: boolean; data: Json; error?: MetaError }> {
  const url = new URL(`${FB}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('access_token', token)
  url.searchParams.set('appsecret_proof', appSecretProof(token, app.appSecret))
  const res = await fetch(url.toString(), { cache: 'no-store' }).catch(() => null)
  if (!res) return { ok: false, data: {}, error: { message: 'network' } }
  const data = (await res.json().catch(() => ({}))) as Json & { error?: MetaError }
  if (!res.ok || data.error) return { ok: false, data, error: data.error ?? { message: `HTTP ${res.status}` } }
  return { ok: true, data }
}

// ── What the login granted ───────────────────────────────────────────────

export interface Grants { valid: boolean; scopes: string[]; targets: Record<string, string[]> }

/** debug_token with the app token: validity, scopes and, per scope, the asset ids the business chose. */
export async function tokenGrants(token: string, app: MetaApp): Promise<Grants> {
  const url = new URL(`${FB}/debug_token`)
  url.searchParams.set('input_token', token)
  url.searchParams.set('access_token', `${app.appId}|${app.appSecret}`)
  const res = await fetch(url.toString(), { cache: 'no-store' }).catch(() => null)
  const body = (await res?.json().catch(() => ({})) ?? {}) as { data?: { is_valid?: boolean; scopes?: unknown; granular_scopes?: unknown } }
  const d = body.data ?? {}
  const scopes = Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : []
  const targets: Record<string, string[]> = {}
  if (Array.isArray(d.granular_scopes)) {
    for (const g of d.granular_scopes as Array<{ scope?: unknown; target_ids?: unknown }>) {
      if (typeof g?.scope !== 'string' || !Array.isArray(g.target_ids)) continue
      targets[g.scope] = g.target_ids.filter((t): t is string => typeof t === 'string' && ID.test(t)).slice(0, 200)
    }
  }
  return { valid: d.is_valid === true, scopes, targets }
}

const ADS_SCOPES = ['ads_read', 'ads_management']
const CATALOG_SCOPES = ['catalog_management']

export function hasAssetScope(kind: AssetKind, scopes: string[]): boolean {
  return (kind === 'ads' ? ADS_SCOPES : CATALOG_SCOPES).some((s) => scopes.includes(s))
}

// ── Discovering the shared assets ────────────────────────────────────────

export interface AdAccountAsset { id: string; name: string; currency: string | null; timezone: string | null; status: number | null }
export interface CatalogAsset { id: string; name: string; productCount: number | null }

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function toAdAccount(row: Json): AdAccountAsset | null {
  const raw = str(row.account_id) ?? (str(row.id) ?? '').replace(/^act_/, '')
  if (!raw || !ID.test(raw)) return null
  return { id: raw, name: str(row.name) ?? `Ad account ${raw}`, currency: str(row.currency, 8), timezone: str(row.timezone_name, 64), status: num(row.account_status) }
}

function toCatalog(row: Json): CatalogAsset | null {
  const id = str(row.id)
  if (!id || !ID.test(id)) return null
  return { id, name: str(row.name) ?? `Catalog ${id}`, productCount: num(row.product_count) }
}

const AD_FIELDS = 'account_id,name,currency,timezone_name,account_status'
const CATALOG_FIELDS = 'id,name,product_count'

/** The ad accounts this login shared, each checked against the token. */
export async function discoverAdAccounts(token: string, app: MetaApp, grants: Grants): Promise<AdAccountAsset[]> {
  const seen = new Map<string, AdAccountAsset>()
  const granted = [...new Set(ADS_SCOPES.flatMap((s) => grants.targets[s] ?? []))].slice(0, MAX_ASSETS)
  for (const id of granted) {
    const r = await graph(`/act_${id}`, token, app, { fields: AD_FIELDS })
    const a = r.ok ? toAdAccount(r.data) : null
    if (a) seen.set(a.id, a)
  }
  if (seen.size === 0) {
    // Fallback: the system user only holds what was shared, so this lists just those.
    const r = await graph('/me/adaccounts', token, app, { fields: AD_FIELDS, limit: String(MAX_ASSETS) })
    for (const row of (r.ok && Array.isArray(r.data.data) ? r.data.data : []) as Json[]) {
      const a = toAdAccount(row)
      if (a) seen.set(a.id, a)
    }
  }
  return [...seen.values()].slice(0, MAX_ASSETS)
}

/** The catalogs this login shared, each checked against the token. */
export async function discoverCatalogs(token: string, app: MetaApp, grants: Grants): Promise<CatalogAsset[]> {
  const seen = new Map<string, CatalogAsset>()
  for (const id of (grants.targets.catalog_management ?? []).slice(0, MAX_ASSETS)) {
    const r = await graph(`/${id}`, token, app, { fields: CATALOG_FIELDS })
    const c = r.ok ? toCatalog(r.data) : null
    if (c) seen.set(c.id, c)
  }
  if (seen.size === 0) {
    const b = await graph('/me/businesses', token, app, { fields: 'id', limit: '10' })
    for (const biz of (b.ok && Array.isArray(b.data.data) ? b.data.data : []) as Json[]) {
      const bizId = str(biz.id)
      if (!bizId || !ID.test(bizId)) continue
      for (const edge of ['owned_product_catalogs', 'client_product_catalogs']) {
        const r = await graph(`/${bizId}/${edge}`, token, app, { fields: CATALOG_FIELDS, limit: String(MAX_ASSETS) })
        for (const row of (r.ok && Array.isArray(r.data.data) ? r.data.data : []) as Json[]) {
          const c = toCatalog(row)
          if (c) seen.set(c.id, c)
        }
      }
    }
  }
  return [...seen.values()].slice(0, MAX_ASSETS)
}

// ── Choice sessions (several assets: the owner picks) ───────────────────

const SESSION_TTL_MS = 15 * 60_000
type AssetOption = AdAccountAsset | CatalogAsset
type AssetSessionOptions = { kind: AssetKind; assets: AssetOption[]; scopes: string[] }

export async function createAssetSession(input: { accountId: string; userId: string; kind: AssetKind; token: string; assets: AssetOption[]; scopes: string[] }): Promise<string> {
  await prisma.metaConnectSession.deleteMany({ where: { account_id: input.accountId } })
  const options: AssetSessionOptions = { kind: input.kind, assets: input.assets.slice(0, MAX_ASSETS), scopes: input.scopes.slice(0, 100) }
  const row = await prisma.metaConnectSession.create({
    data: {
      account_id: input.accountId,
      user_id: input.userId,
      token: sealSecret(input.token) ?? '',
      options: options as unknown as object,
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    },
    select: { id: true },
  })
  return row.id
}

function asAssetOptions(v: unknown, kind?: AssetKind): AssetSessionOptions | null {
  const o = v as Partial<AssetSessionOptions> | null
  if (!o || (o.kind !== 'ads' && o.kind !== 'catalog') || !Array.isArray(o.assets)) return null
  if (kind && o.kind !== kind) return null
  return { kind: o.kind, assets: o.assets, scopes: Array.isArray(o.scopes) ? o.scopes : [] }
}

/** The choices of this owner's session — no token. */
export async function readAssetChoices(id: string, accountId: string, userId: string) {
  const row = await prisma.metaConnectSession.findFirst({
    where: { id, account_id: accountId, user_id: userId, used_at: null, expires_at: { gt: new Date() } },
    select: { options: true },
  })
  const o = asAssetOptions(row?.options)
  return o ? { kind: o.kind, assets: o.assets } : null
}

/** Claim the session once (a double click cannot save twice). */
export async function claimAssetSession(id: string, accountId: string, userId: string) {
  const claimed = await prisma.metaConnectSession.updateMany({
    where: { id, account_id: accountId, user_id: userId, used_at: null, expires_at: { gt: new Date() } },
    data: { used_at: new Date() },
  })
  if (claimed.count !== 1) return null
  const row = await prisma.metaConnectSession.findFirst({ where: { id, account_id: accountId }, select: { token: true, options: true } })
  await prisma.metaConnectSession.deleteMany({ where: { id, account_id: accountId } })
  const o = asAssetOptions(row?.options)
  const token = openStoredSecret(row?.token ?? null)
  if (!o || !token) return null
  return { token, ...o }
}

// ── Saving ───────────────────────────────────────────────────────────────

/**
 * Save the chosen assets under one new connection (sealed token). An asset
 * already connected in this workspace moves to the new connection (a
 * reconnect). The first asset becomes the default when there is none.
 * Connections left with no assets are removed (their token goes with them).
 */
export async function saveAssets(input: { accountId: string; userId: string; kind: AssetKind; token: string; scopes: string[]; assets: AssetOption[] }): Promise<{ saved: number }> {
  const assets = input.assets.slice(0, MAX_ASSETS)
  if (assets.length === 0) return { saved: 0 }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const conn = await tx.metaAssetConnection.create({
      data: { account_id: input.accountId, kind: input.kind, access_token: sealSecret(input.token) ?? '', scopes: input.scopes.slice(0, 100), status: 'connected', connected_by: input.userId },
      select: { id: true },
    })
    if (input.kind === 'ads') {
      const hasDefault = (await tx.metaAdAccount.count({ where: { account_id: input.accountId, is_default: true } })) > 0
      for (const [i, a] of (assets as AdAccountAsset[]).entries()) {
        await tx.metaAdAccount.upsert({
          where: { account_id_ad_account_id: { account_id: input.accountId, ad_account_id: a.id } },
          create: { account_id: input.accountId, connection_id: conn.id, ad_account_id: a.id, name: a.name, currency: a.currency, timezone_name: a.timezone, account_status: a.status, is_default: !hasDefault && i === 0, last_checked_at: now },
          update: { connection_id: conn.id, name: a.name, currency: a.currency, timezone_name: a.timezone, account_status: a.status, last_checked_at: now, last_error: null },
        })
      }
    } else {
      const hasDefault = (await tx.metaCatalog.count({ where: { account_id: input.accountId, is_default: true } })) > 0
      for (const [i, c] of (assets as CatalogAsset[]).entries()) {
        await tx.metaCatalog.upsert({
          where: { account_id_catalog_id: { account_id: input.accountId, catalog_id: c.id } },
          create: { account_id: input.accountId, connection_id: conn.id, catalog_id: c.id, name: c.name, product_count: c.productCount, is_default: !hasDefault && i === 0, last_checked_at: now },
          update: { connection_id: conn.id, name: c.name, product_count: c.productCount, last_checked_at: now, last_error: null },
        })
      }
    }
  })
  await removeEmptyConnections(input.accountId, input.kind)
  await mirrorDefault(input.accountId, input.kind, input.userId)
  return { saved: assets.length }
}

async function removeEmptyConnections(accountId: string, kind: AssetKind) {
  const conns = await prisma.metaAssetConnection.findMany({ where: { account_id: accountId, kind }, select: { id: true } })
  for (const c of conns) {
    const used = kind === 'ads'
      ? await prisma.metaAdAccount.count({ where: { account_id: accountId, connection_id: c.id } })
      : await prisma.metaCatalog.count({ where: { account_id: accountId, connection_id: c.id } })
    if (used === 0) await prisma.metaAssetConnection.deleteMany({ where: { id: c.id, account_id: accountId } })
  }
}

/**
 * Copy the default ad account / catalog (and its token) into the older
 * single-row table every existing feature reads. With none left, the ads
 * row keeps its Conversions API dataset but loses the ad account; the
 * catalog row is removed.
 */
export async function mirrorDefault(accountId: string, kind: AssetKind, userId: string): Promise<void> {
  if (kind === 'ads') {
    const def = await prisma.metaAdAccount.findFirst({ where: { account_id: accountId, is_default: true }, select: { ad_account_id: true, connection_id: true } })
    const conn = def ? await prisma.metaAssetConnection.findFirst({ where: { id: def.connection_id, account_id: accountId }, select: { access_token: true, business_id: true } }) : null
    const token = conn ? openStoredSecret(conn.access_token) : null
    const existing = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { id: true } })
    if (!def || !token) {
      if (existing) await prisma.metaAdsConfig.update({ where: { account_id: accountId }, data: { ad_account_id: null } })
      return
    }
    const data = { ad_account_id: `act_${def.ad_account_id}`, access_token: encrypt(token), business_id: conn?.business_id ?? null, status: 'connected' }
    if (existing) await prisma.metaAdsConfig.update({ where: { account_id: accountId }, data })
    else await prisma.metaAdsConfig.create({ data: { account_id: accountId, user_id: userId, waba_id: '', connected_at: new Date(), ...data } })
    return
  }
  const def = await prisma.metaCatalog.findFirst({ where: { account_id: accountId, is_default: true }, select: { catalog_id: true, connection_id: true } })
  const conn = def ? await prisma.metaAssetConnection.findFirst({ where: { id: def.connection_id, account_id: accountId }, select: { access_token: true, business_id: true } }) : null
  const token = conn ? openStoredSecret(conn.access_token) : null
  if (!def || !token) {
    await prisma.catalogConfig.deleteMany({ where: { account_id: accountId } })
    return
  }
  const data = { catalog_id: def.catalog_id, access_token: encrypt(token), business_id: conn?.business_id ?? null, status: 'connected' }
  await prisma.catalogConfig.upsert({
    where: { account_id: accountId },
    create: { account_id: accountId, user_id: userId, connected_at: new Date(), ...data },
    update: data,
  })
}

// ── Listing, default, removing, checking ─────────────────────────────────

/** Meta's account_status in plain words. */
export function adAccountHealth(status: number | null | undefined, lastError: string | null | undefined): { level: 'ok' | 'warn' | 'error' | 'unknown'; text: string } {
  if (lastError) return { level: 'error', text: lastError }
  switch (status) {
    case 1: return { level: 'ok', text: 'Active' }
    case 2: return { level: 'error', text: 'Disabled by Meta' }
    case 3: return { level: 'warn', text: 'Payment problem — settle the balance in Ads Manager' }
    case 7: return { level: 'warn', text: 'Under risk review by Meta' }
    case 8: return { level: 'warn', text: 'Payment pending settlement' }
    case 9: return { level: 'warn', text: 'In grace period — check payment' }
    case 100: return { level: 'warn', text: 'Closing soon' }
    case 101: return { level: 'error', text: 'Closed' }
    default: return { level: 'unknown', text: 'Not checked yet' }
  }
}

export async function listAssets(accountId: string, kind: AssetKind) {
  if (kind === 'ads') {
    const rows = await prisma.metaAdAccount.findMany({ where: { account_id: accountId }, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] })
    return rows.map((r) => ({
      id: r.id, externalId: r.ad_account_id, name: r.name, currency: r.currency, timezone: r.timezone_name,
      isDefault: r.is_default, health: adAccountHealth(r.account_status, r.last_error), lastCheckedAt: r.last_checked_at, productCount: null as number | null,
    }))
  }
  const rows = await prisma.metaCatalog.findMany({ where: { account_id: accountId }, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] })
  return rows.map((r) => ({
    id: r.id, externalId: r.catalog_id, name: r.name, currency: null as string | null, timezone: null as string | null,
    isDefault: r.is_default, health: r.last_error ? { level: 'error' as const, text: r.last_error } : { level: (r.last_checked_at ? 'ok' : 'unknown') as 'ok' | 'unknown', text: r.last_checked_at ? 'Connected' : 'Not checked yet' },
    lastCheckedAt: r.last_checked_at, productCount: r.product_count,
  }))
}

/** Make one asset the default (atomic: never two defaults). False when it is not this workspace's. */
export async function setDefaultAsset(accountId: string, kind: AssetKind, id: string, userId: string): Promise<boolean> {
  const ok = await prisma.$transaction(async (tx) => {
    if (kind === 'ads') {
      const row = await tx.metaAdAccount.findFirst({ where: { id, account_id: accountId }, select: { id: true } })
      if (!row) return false
      await tx.metaAdAccount.updateMany({ where: { account_id: accountId, is_default: true }, data: { is_default: false } })
      await tx.metaAdAccount.updateMany({ where: { id, account_id: accountId }, data: { is_default: true } })
      return true
    }
    const row = await tx.metaCatalog.findFirst({ where: { id, account_id: accountId }, select: { id: true } })
    if (!row) return false
    await tx.metaCatalog.updateMany({ where: { account_id: accountId, is_default: true }, data: { is_default: false } })
    await tx.metaCatalog.updateMany({ where: { id, account_id: accountId }, data: { is_default: true } })
    return true
  })
  if (ok) await mirrorDefault(accountId, kind, userId)
  return ok
}

/** Remove one asset. When it was the default, the oldest remaining one takes over. */
export async function removeAsset(accountId: string, kind: AssetKind, id: string, userId: string): Promise<boolean> {
  const removed = await prisma.$transaction(async (tx) => {
    if (kind === 'ads') {
      const row = await tx.metaAdAccount.findFirst({ where: { id, account_id: accountId }, select: { is_default: true } })
      if (!row) return false
      await tx.metaAdAccount.deleteMany({ where: { id, account_id: accountId } })
      if (row.is_default) {
        const next = await tx.metaAdAccount.findFirst({ where: { account_id: accountId }, orderBy: { created_at: 'asc' }, select: { id: true } })
        if (next) await tx.metaAdAccount.updateMany({ where: { id: next.id, account_id: accountId }, data: { is_default: true } })
      }
      return true
    }
    const row = await tx.metaCatalog.findFirst({ where: { id, account_id: accountId }, select: { is_default: true } })
    if (!row) return false
    await tx.metaCatalog.deleteMany({ where: { id, account_id: accountId } })
    if (row.is_default) {
      const next = await tx.metaCatalog.findFirst({ where: { account_id: accountId }, orderBy: { created_at: 'asc' }, select: { id: true } })
      if (next) await tx.metaCatalog.updateMany({ where: { id: next.id, account_id: accountId }, data: { is_default: true } })
    }
    return true
  })
  if (!removed) return false
  await removeEmptyConnections(accountId, kind)
  await mirrorDefault(accountId, kind, userId)
  return true
}

/** Re-read one asset from Meta with its connection's token; store plain-words health. */
export async function checkAsset(accountId: string, kind: AssetKind, id: string, app: MetaApp): Promise<boolean> {
  const row = kind === 'ads'
    ? await prisma.metaAdAccount.findFirst({ where: { id, account_id: accountId }, select: { ad_account_id: true, connection_id: true } })
    : await prisma.metaCatalog.findFirst({ where: { id, account_id: accountId }, select: { catalog_id: true, connection_id: true } })
  if (!row) return false
  const conn = await prisma.metaAssetConnection.findFirst({ where: { id: row.connection_id, account_id: accountId }, select: { access_token: true } })
  const token = conn ? openStoredSecret(conn.access_token) : null
  const now = new Date()
  const failText = (e?: MetaError) =>
    e?.code === 190 ? 'The connection expired — press Connect again'
      : e?.code === 10 || e?.code === 200 || e?.code === 100 ? 'Meta no longer allows access — press Connect again and share this account'
        : 'Meta did not answer — try again later'
  if (kind === 'ads') {
    const ext = (row as { ad_account_id: string }).ad_account_id
    const r = token ? await graph(`/act_${ext}`, token, app, { fields: AD_FIELDS }) : { ok: false, data: {}, error: { code: 190 } as MetaError }
    if (!r.ok) console.warn('[meta assets] ad account check failed:', r.error?.code, r.error?.message)
    const a = r.ok ? toAdAccount(r.data) : null
    await prisma.metaAdAccount.updateMany({
      where: { id, account_id: accountId },
      data: a ? { name: a.name, currency: a.currency, timezone_name: a.timezone, account_status: a.status, last_checked_at: now, last_error: null } : { last_checked_at: now, last_error: failText(r.error) },
    })
    return true
  }
  const ext = (row as { catalog_id: string }).catalog_id
  const r = token ? await graph(`/${ext}`, token, app, { fields: CATALOG_FIELDS }) : { ok: false, data: {}, error: { code: 190 } as MetaError }
  if (!r.ok) console.warn('[meta assets] catalog check failed:', r.error?.code, r.error?.message)
  const c = r.ok ? toCatalog(r.data) : null
  await prisma.metaCatalog.updateMany({
    where: { id, account_id: accountId },
    data: c ? { name: c.name, product_count: c.productCount, last_checked_at: now, last_error: null } : { last_checked_at: now, last_error: failText(r.error) },
  })
  return true
}
