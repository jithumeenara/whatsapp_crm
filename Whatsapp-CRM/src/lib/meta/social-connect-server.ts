/**
 * Shared by the /api/meta/social-connect/* routes (route files may only
 * export HTTP handlers): the platform Meta App, our callback address, and
 * the pending-choice sessions.
 */

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { decrypt, openStoredSecret, sealSecret } from '@/lib/whatsapp/encryption'
import type { MetaApp, PageAsset, InstagramAsset } from './social-connect'
import type { ConnectKind, SocialChannel } from './connect-state'

export const CONNECT_CALLBACK_PATH = '/api/meta/social-connect/callback'
export const SESSION_TTL_MS = 15 * 60_000

/** Our public origin from the server's own setting — never the request's Host header. */
export function connectOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return null
    return u.origin
  } catch {
    return null
  }
}

type ConfigRow = { app_id: string; app_secret: string; instagram_config_id: string | null; messenger_config_id: string | null; ads_config_id: string | null; catalog_config_id: string | null }

function configFor(row: ConfigRow, kind: ConnectKind): string | null {
  const v = kind === 'instagram' ? row.instagram_config_id
    : kind === 'facebook' ? row.messenger_config_id
    : kind === 'ads' ? row.ads_config_id
    : row.catalog_config_id
  return v && /^\d{5,30}$/.test(v) ? v : null
}

async function loadConfigRow(): Promise<ConfigRow | null> {
  const row = await prisma.metaPlatformConfig.findUnique({
    where: { id: 'singleton' },
    select: { app_id: true, app_secret: true, instagram_config_id: true, messenger_config_id: true, ads_config_id: true, catalog_config_id: true },
  })
  return row?.app_id && row.app_secret ? row : null
}

/**
 * The server's Meta App with the Facebook Login for Business configuration
 * for one channel ("Connect Instagram" or "Connect Messenger"). Without a
 * channel: the app, when either channel is set up.
 */
export async function loadSocialApp(channel?: ConnectKind): Promise<(MetaApp & { configId: string }) | null> {
  const row = await loadConfigRow()
  if (!row) return null
  const configId = channel ? configFor(row, channel) : configFor(row, 'instagram') ?? configFor(row, 'facebook')
  if (!configId) return null
  return { appId: row.app_id, appSecret: decrypt(row.app_secret), configId }
}

/** Which one-click buttons this server can show. */
export async function socialConnectReady(): Promise<Record<ConnectKind, boolean>> {
  const row = await loadConfigRow()
  const ok = (k: ConnectKind) => Boolean(row && configFor(row, k))
  return { instagram: ok('instagram'), facebook: ok('facebook'), ads: ok('ads'), catalog: ok('catalog') }
}

export async function loadMetaAppOnly(): Promise<MetaApp | null> {
  const row = await prisma.metaPlatformConfig.findUnique({ where: { id: 'singleton' }, select: { app_id: true, app_secret: true } })
  if (!row?.app_id || !row.app_secret) return null
  return { appId: row.app_id, appSecret: decrypt(row.app_secret) }
}

/**
 * What a button may connect: "Connect Instagram" only Instagram accounts,
 * "Connect Messenger" only Pages. No channel (a link started before the
 * buttons were separate): both, as then.
 */
export function assetsForChannel(channel: SocialChannel | null | undefined, pages: PageAsset[], instagram: InstagramAsset[]): { pages: PageAsset[]; instagram: InstagramAsset[] } {
  if (channel === 'instagram') return { pages: [], instagram }
  if (channel === 'facebook') return { pages, instagram: [] }
  return { pages, instagram }
}

/** The Page an Instagram account is linked to, if Meta listed it (noted, never connected). */
export function linkedPageId(pages: Array<{ id: string; igId: string | null }>, igId: string | null | undefined): string | null {
  if (!igId) return null
  return pages.find((p) => p.igId === igId)?.id ?? null
}

/** Where Settings shows the result. */
export function settingsUrl(origin: string, params: Record<string, string>, tab: 'channels' | 'ads' | 'catalog' = 'channels'): string {
  const q = new URLSearchParams({ tab, ...params })
  return `${origin}/settings?${q.toString()}`
}

type StoredOptions = {
  /** Absent on sessions made before channels were separate (both offered). */
  channel?: SocialChannel
  pages: Array<{ id: string; name: string; igId: string | null; token: string }>
  instagram: InstagramAsset[]
  scopes: string[]
  expiresAt: string | null
}

/** Keep the choices for 15 minutes (tokens sealed) and return the session id. */
export async function createConnectSession(input: {
  accountId: string; userId: string; token: string; pages: PageAsset[]; instagram: InstagramAsset[]; scopes: string[]; expiresAt: Date | null; channel?: SocialChannel
}): Promise<string> {
  // Old sessions of this workspace go first: one pending choice at a time.
  await prisma.metaConnectSession.deleteMany({ where: { account_id: input.accountId } })
  const options: StoredOptions = {
    ...(input.channel ? { channel: input.channel } : {}),
    pages: input.pages.map((p) => ({ id: p.id, name: p.name, igId: p.igId, token: sealSecret(p.token) ?? '' })),
    instagram: input.instagram,
    scopes: input.scopes,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
  }
  const row = await prisma.metaConnectSession.create({
    data: {
      account_id: input.accountId,
      user_id: input.userId,
      token: sealSecret(input.token) ?? '',
      options: options as unknown as Prisma.InputJsonValue,
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    },
    select: { id: true },
  })
  return row.id
}

/** The choices for this owner's session — without tokens (for the screen). */
export async function readConnectChoices(id: string, accountId: string, userId: string) {
  const row = await prisma.metaConnectSession.findFirst({
    where: { id, account_id: accountId, user_id: userId, used_at: null, expires_at: { gt: new Date() } },
    select: { options: true },
  })
  if (!row) return null
  const o = row.options as unknown as StoredOptions & { kind?: string }
  if (o.kind) return null // an ads / catalog choice, read by /api/meta/assets/finish
  // Only the button's own channel is offered (pages stay server side for an
  // Instagram session: they are used only to note the linked Page).
  return {
    channel: o.channel ?? null,
    pages: o.channel === 'instagram' ? [] : (o.pages ?? []).map((p) => ({ id: p.id, name: p.name, igId: p.igId })),
    instagram: o.channel === 'facebook' ? [] : o.instagram ?? [],
  }
}

/**
 * Claim the session once ("twice is once": a double click cannot save
 * twice) and return the sealed details opened.
 */
export async function claimConnectSession(id: string, accountId: string, userId: string) {
  const claimed = await prisma.metaConnectSession.updateMany({
    where: { id, account_id: accountId, user_id: userId, used_at: null, expires_at: { gt: new Date() } },
    data: { used_at: new Date() },
  })
  if (claimed.count !== 1) return null
  const row = await prisma.metaConnectSession.findFirst({ where: { id, account_id: accountId }, select: { token: true, options: true } })
  await prisma.metaConnectSession.deleteMany({ where: { id, account_id: accountId } })
  if (!row) return null
  const o = row.options as unknown as StoredOptions & { kind?: string }
  // An ads / catalog choice is finished by /api/meta/assets/finish, never here.
  if (o.kind) return null
  const token = openStoredSecret(row.token)
  if (!token) return null
  return {
    token,
    channel: o.channel ?? null,
    pages: (o.pages ?? []).map((p) => ({ id: p.id, name: p.name, igId: p.igId, token: openStoredSecret(p.token) ?? '' })),
    instagram: o.instagram ?? [],
    scopes: o.scopes ?? [],
    expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
  }
}
