import webpush from 'web-push'
import { prisma } from '@/lib/db'

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@whatsappcrm.local'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys not configured. Run /api/push/vapid to generate them.')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
}

export interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  data?: Record<string, unknown>
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    ensureVapid()
  } catch {
    return // VAPID not configured — silently skip
  }

  const subs = await prisma.pushSubscription.findMany({ where: { user_id: userId } })
  if (subs.length === 0) return

  const json = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        )
      } catch (err: unknown) {
        // 410 Gone = subscription expired
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
      }
    }),
  )
}

export async function sendPushToAccount(accountId: string, payload: PushPayload): Promise<void> {
  try {
    ensureVapid()
  } catch {
    return
  }

  const subs = await prisma.pushSubscription.findMany({ where: { account_id: accountId } })
  if (subs.length === 0) return

  const json = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        )
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
      }
    }),
  )
}
