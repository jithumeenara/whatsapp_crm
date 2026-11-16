/**
 * Shared by the /api/meta/social-connect/* routes (route files may only
 * export HTTP handlers): the platform Meta App, our callback address, and
 * the pending-choice sessions.
 */

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { decrypt, openStoredSecret, sealSecret } from '@/lib/whatsapp/encryption'
import type { MetaApp, PageAsset, InstagramAsset } from './social-connect'

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

/** The server's Meta App (Settings → Platform) with the Messenger + Instagram configuration. */
export async function loadSocialApp(): Promise<(MetaApp & { configId: string }) | null> {
  const row = await prisma.metaPlatformConfig.findUnique({
    where: { id: 'singleton' },
    select: { app_id: true, app_secret: true, social_config_id: true },
  })
  if (!row?.app_id || !row.app_secret || !row.social_config_id) return null
  return { appId: row.app_id, appSecret: decrypt(row.app_secret), configId: row.social_config_id }
}

export async function loadMetaAppOnly(): Promise<MetaApp | null> {
  const row = await prisma.metaPlatformConfig.findUnique({ where: { id: 'singleton' }, select: { app_id: true, app_secret: true } })
  if (!row?.app_id || !row.app_secret) return null
  return { appId: row.app_id, appSecret: decrypt(row.app_secret) }
}

/** Where Settings shows the result. */
export function settingsUrl(origin: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ tab: 'channels', ...params })
  return `${origin}/settings?${q.toString()}`
}

type StoredOptions = {
  pages: Array<{ id: string; name: string; igId: string | null; token: string }>
  instagram: InstagramAsset[]
  scopes: string[]
  expiresAt: string | null
}

/** Keep the choices for 15 minutes (tokens sealed) and return the session id. */
export async function createConnectSession(input: {
  accountId: string; userId: string; token: string; pages: PageAsset[]; instagram: InstagramAsset[]; scopes: string[]; expiresAt: Date | null
}): Promise<string> {
  // Old sessions of this workspace go first: one pending choice at a time.
  await prisma.metaConnectSession.deleteMany({ where: { account_id: input.accountId } })
  const options: StoredOptions = {
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
  const o = row.options as unknown as StoredOptions
  return {
    pages: (o.pages ?? []).map((p) => ({ id: p.id, name: p.name, igId: p.igId })),
    instagram: o.instagram ?? [],
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
  const o = row.options as unknown as StoredOptions
  const token = openStoredSecret(row.token)
  if (!token) return null
  return {
    token,
    pages: (o.pages ?? []).map((p) => ({ id: p.id, name: p.name, igId: p.igId, token: openStoredSecret(p.token) ?? '' })),
    instagram: o.instagram ?? [],
    scopes: o.scopes ?? [],
    expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
  }
}
