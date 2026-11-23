/**
 * Which catalog a WhatsApp number uses, and linking a catalog to a WABA.
 *
 * Meta: one catalog per WhatsApp Business Account, shared by its numbers.
 * waba_catalogs (migration 193) remembers the choice per WABA; with none,
 * the workspace's default catalog is used (as before). Linking calls
 * POST /{waba-id}/product_catalogs with that WABA's own WhatsApp token,
 * then sets catalog / cart visibility on each of its numbers.
 *
 * Ids are digits only, every lookup carries account_id, tokens stay on the
 * server and Meta's own error text stays in the log. Free of next/server.
 */

import { prisma } from '@/lib/db'
import { decrypt, openStoredSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const ID = /^\d{1,30}$/

/** The catalog this WABA's numbers send from: its own, else the default. Null when none is connected. */
export async function catalogForWaba(accountId: string, wabaId: string | null | undefined): Promise<string | null> {
  if (wabaId && ID.test(wabaId)) {
    const link = await prisma.wabaCatalog.findUnique({ where: { account_id_waba_id: { account_id: accountId, waba_id: wabaId } }, select: { catalog_id: true } }).catch(() => null)
    if (link?.catalog_id) return link.catalog_id
  }
  const def = await prisma.metaCatalog.findFirst({ where: { account_id: accountId, is_default: true }, select: { catalog_id: true } }).catch(() => null)
  if (def?.catalog_id) return def.catalog_id
  const legacy = await prisma.catalogConfig.findUnique({ where: { account_id: accountId }, select: { catalog_id: true } }).catch(() => null)
  return legacy?.catalog_id ?? null
}

/** The catalog of the number a conversation is on. */
export async function catalogForConversation(accountId: string, conversationId: string | null | undefined): Promise<string | null> {
  if (!conversationId) return catalogForWaba(accountId, null)
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, account_id: accountId }, select: { whatsapp_config_id: true } }).catch(() => null)
  const cfg = conv?.whatsapp_config_id
    ? await prisma.whatsAppConfig.findFirst({ where: { id: conv.whatsapp_config_id, account_id: accountId }, select: { waba_id: true } }).catch(() => null)
    : null
  return catalogForWaba(accountId, cfg?.waba_id ?? null)
}

/** A connected catalog's id and token (this workspace only): a Connect Catalog row, else the default row. */
export async function catalogAccess(accountId: string, catalogId?: string | null): Promise<{ catalogId: string; token: string } | null> {
  if (catalogId) {
    if (!ID.test(catalogId)) return null
    const row = await prisma.metaCatalog.findFirst({ where: { account_id: accountId, catalog_id: catalogId }, select: { connection_id: true } })
    if (row) {
      const conn = await prisma.metaAssetConnection.findFirst({ where: { id: row.connection_id, account_id: accountId }, select: { access_token: true } })
      const token = conn ? openStoredSecret(conn.access_token) : null
      return token ? { catalogId, token } : null
    }
  }
  const legacy = await prisma.catalogConfig.findUnique({ where: { account_id: accountId }, select: { catalog_id: true, access_token: true } })
  if (!legacy || (catalogId && legacy.catalog_id !== catalogId)) return null
  return { catalogId: legacy.catalog_id, token: decrypt(legacy.access_token) }
}

/** This workspace's WhatsApp Business Accounts, their numbers and chosen catalog. */
export async function wabaCatalogOverview(accountId: string) {
  const configs = await prisma.whatsAppConfig.findMany({
    where: { account_id: accountId, waba_id: { not: null } },
    select: { waba_id: true, label: true, phone_number_id: true, status: true },
    take: 50,
  })
  const links = await prisma.wabaCatalog.findMany({ where: { account_id: accountId } })
  const byWaba = new Map<string, { wabaId: string; numbers: string[]; catalogId: string | null; catalogVisible: boolean; cartEnabled: boolean; lastError: string | null }>()
  for (const c of configs) {
    if (!c.waba_id || !ID.test(c.waba_id)) continue
    const link = links.find((l) => l.waba_id === c.waba_id)
    const row = byWaba.get(c.waba_id) ?? { wabaId: c.waba_id, numbers: [], catalogId: link?.catalog_id ?? null, catalogVisible: link?.catalog_visible ?? true, cartEnabled: link?.cart_enabled ?? true, lastError: link?.last_error ?? null }
    row.numbers.push(c.label || `Number ${c.phone_number_id.slice(-4)}`)
    byWaba.set(c.waba_id, row)
  }
  return [...byWaba.values()]
}

type LinkResult = { ok: true } | { ok: false; error: string }

/**
 * Link a connected catalog to one of this workspace's WABAs at Meta, set
 * catalog / cart visibility on its numbers, and remember the choice.
 */
export async function linkCatalogToWaba(input: { accountId: string; userId: string; wabaId: string; catalogId: string; catalogVisible: boolean; cartEnabled: boolean }): Promise<LinkResult> {
  const { accountId, wabaId, catalogId } = input
  if (!ID.test(wabaId) || !ID.test(catalogId)) return { ok: false, error: 'Choose a WhatsApp account and a catalog.' }
  const catalog = await prisma.metaCatalog.findFirst({ where: { account_id: accountId, catalog_id: catalogId }, select: { id: true } })
  const legacy = catalog ? null : await prisma.catalogConfig.findFirst({ where: { account_id: accountId, catalog_id: catalogId }, select: { id: true } })
  if (!catalog && !legacy) return { ok: false, error: 'That catalog is not connected to this workspace.' }
  const numbers = await prisma.whatsAppConfig.findMany({ where: { account_id: accountId, waba_id: wabaId }, select: { phone_number_id: true, access_token: true } })
  if (numbers.length === 0) return { ok: false, error: 'That WhatsApp account is not connected to this workspace.' }

  let token: string
  try { token = decrypt(numbers[0].access_token) } catch { return { ok: false, error: 'Reconnect this WhatsApp number first.' } }

  const res = await fetch(`${GRAPH}/${wabaId}/product_catalogs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalog_id: catalogId }),
  }).catch(() => null)
  if (!res?.ok) {
    const body = (await res?.json().catch(() => ({})) ?? {}) as { error?: { code?: number; message?: string } }
    console.warn('[catalog link] Meta refused the WABA link:', res?.status ?? 0, body.error?.code, body.error?.message)
    const error = body.error?.code === 190 ? 'The WhatsApp connection expired — reconnect it.'
      : body.error?.code === 10 || body.error?.code === 200 || body.error?.code === 100 ? 'Meta did not allow it — the WhatsApp token needs catalog_management, and the catalog must belong to the same business.'
        : 'Meta did not link the catalog — try again in a minute.'
    await prisma.wabaCatalog.upsert({
      where: { account_id_waba_id: { account_id: accountId, waba_id: wabaId } },
      create: { account_id: accountId, waba_id: wabaId, catalog_id: catalogId, catalog_visible: input.catalogVisible, cart_enabled: input.cartEnabled, linked_by: input.userId, last_error: error },
      update: { last_error: error },
    }).catch(() => {})
    return { ok: false, error }
  }

  // Visibility on each number of this WABA (best effort, reported).
  let settingsFailed = false
  for (const n of numbers) {
    if (!ID.test(n.phone_number_id)) continue
    const url = new URL(`${GRAPH}/${n.phone_number_id}/whatsapp_commerce_settings`)
    url.searchParams.set('is_catalog_visible', String(input.catalogVisible))
    url.searchParams.set('is_cart_enabled', String(input.cartEnabled))
    const r = await fetch(url.toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!r?.ok) { settingsFailed = true; console.warn('[catalog link] commerce settings failed for a number:', r?.status ?? 0) }
  }

  await prisma.wabaCatalog.upsert({
    where: { account_id_waba_id: { account_id: accountId, waba_id: wabaId } },
    create: { account_id: accountId, waba_id: wabaId, catalog_id: catalogId, catalog_visible: input.catalogVisible, cart_enabled: input.cartEnabled, linked_by: input.userId, last_error: settingsFailed ? 'Catalog linked, but showing it / the cart could not be set on every number — try Save again.' : null },
    update: { catalog_id: catalogId, catalog_visible: input.catalogVisible, cart_enabled: input.cartEnabled, linked_by: input.userId, linked_at: new Date(), last_error: settingsFailed ? 'Catalog linked, but showing it / the cart could not be set on every number — try Save again.' : null },
  })
  return { ok: true }
}
