/**
 * Every few hours: is each Messenger / Instagram connection still working?
 *
 *  - Facebook-family tokens (Page, System User, Unified Login): checked with
 *    debug_token. A token that stopped (the customer removed the app, moved
 *    the account, changed a password) marks the channel "error" with a plain
 *    message, and the workspace's owners and admins get a push — once, when
 *    it changes, not every run.
 *  - Instagram Login tokens (IGAA…, 60 days): refreshed when they are at
 *    least a day old and within 10 days of expiring (or expiry unknown), so
 *    they never silently die; a refresh that fails is treated the same way.
 *
 * Imported by server.ts: no next/server here or in anything it imports.
 */

import { prisma } from '@/lib/db'
import { openStoredSecret, sealSecret } from '@/lib/whatsapp/encryption'
import { notifyAdmins } from '@/lib/admin-chat/notify'
import { GRAPH_API_VERSION } from './versions'
import { isFacebookToken } from './social-messaging'
import { tokenInfo, type MetaApp } from './social-connect'
import { decrypt } from '@/lib/whatsapp/encryption'

const DAY = 24 * 60 * 60 * 1000

type Row = { account_id: string; access_token: string | null; token_kind: string | null; token_expires_at: Date | null; updated_at: Date | null }

async function loadApp(): Promise<MetaApp | null> {
  const row = await prisma.metaPlatformConfig.findUnique({ where: { id: 'singleton' }, select: { app_id: true, app_secret: true } }).catch(() => null)
  if (!row?.app_id || !row.app_secret) return null
  try { return { appId: row.app_id, appSecret: decrypt(row.app_secret) } } catch { return null }
}

/** Pure: should this Instagram Login token be refreshed now? */
export function needsIgRefresh(expiresAt: Date | null, lastUpdated: Date | null, now: Date): boolean {
  if (lastUpdated && now.getTime() - lastUpdated.getTime() < DAY) return false // Meta: at least 24 h old
  if (!expiresAt) return true
  return expiresAt.getTime() - now.getTime() < 10 * DAY
}

async function markBroken(table: 'facebook_config' | 'instagram_config', accountId: string, message: string, label: string) {
  const changed = table === 'facebook_config'
    ? await prisma.$executeRaw`UPDATE facebook_config SET status = 'error', test_error = ${message}, updated_at = now() WHERE account_id = ${accountId}::uuid AND status = 'connected'`
    : await prisma.$executeRaw`UPDATE instagram_config SET status = 'error', test_error = ${message}, updated_at = now() WHERE account_id = ${accountId}::uuid AND status = 'connected'`
  if (changed > 0) {
    await notifyAdmins({ accountId, exceptUserId: null, title: `${label} stopped working`, body: `${message} Open Settings → Channels and press Reconnect.` })
  }
}

export async function sweepSocialConnections(now = new Date()): Promise<{ checked: number; broken: number; refreshed: number }> {
  const app = await loadApp()
  let checked = 0, broken = 0, refreshed = 0

  for (const table of ['facebook_config', 'instagram_config'] as const) {
    const rows = await (table === 'facebook_config'
      ? prisma.$queryRaw<Row[]>`SELECT account_id::text AS account_id, access_token, token_kind, token_expires_at, updated_at FROM facebook_config WHERE status = 'connected' AND access_token IS NOT NULL LIMIT 500`
      : prisma.$queryRaw<Row[]>`SELECT account_id::text AS account_id, access_token, token_kind, token_expires_at, updated_at FROM instagram_config WHERE status = 'connected' AND access_token IS NOT NULL LIMIT 500`
    ).catch(() => [] as Row[])
    const label = table === 'facebook_config' ? 'Messenger' : 'Instagram'

    for (const row of rows) {
      let token: string | null = null
      try { token = openStoredSecret(row.access_token) } catch { token = null }
      if (!token) continue
      checked++

      if (isFacebookToken(token)) {
        if (!app) continue
        const info = await tokenInfo(token, app).catch(() => null)
        if (info && !info.valid) {
          broken++
          await markBroken(table, row.account_id, `The ${label} connection was removed or expired at Meta.`, label)
        }
        continue
      }

      // Instagram Login token: keep it alive.
      if (table !== 'instagram_config' || !needsIgRefresh(row.token_expires_at, row.updated_at, now)) continue
      const url = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/refresh_access_token`)
      url.searchParams.set('grant_type', 'ig_refresh_token')
      url.searchParams.set('access_token', token)
      const res = await fetch(url.toString(), { cache: 'no-store' }).catch(() => null)
      const body = (await res?.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { code?: number; message?: string } } | undefined
      if (res?.ok && body?.access_token) {
        const expires = typeof body.expires_in === 'number' ? new Date(now.getTime() + body.expires_in * 1000) : null
        await prisma.$executeRaw`
          UPDATE instagram_config SET access_token = ${sealSecret(body.access_token)}, token_expires_at = ${expires}, token_kind = 'instagram_login', updated_at = now()
          WHERE account_id = ${row.account_id}::uuid`
        refreshed++
      } else if (body?.error?.code === 190) {
        broken++
        await markBroken('instagram_config', row.account_id, 'The Instagram token expired and could not be renewed.', 'Instagram')
      }
    }
  }
  return { checked, broken, refreshed }
}
