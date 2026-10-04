/**
 * Where do this number's customer messages go — and do they arrive?
 *
 * A number can look perfectly connected (token works, number registered,
 * WhatsApp account subscribed) while every customer message goes to some
 * other server. Meta picks the address in this order, per its webhook
 * override docs:
 *
 *   1. an address set on the phone number itself
 *   2. an address set on the WhatsApp Business account
 *   3. the Meta app's own callback URL
 *
 * A Meta app has exactly one callback URL, so two sites sharing one app
 * (two clients of the same CRM, say) cannot both receive messages through
 * it; a previous provider can also leave its own address on the account.
 * Then the messages are signed with that app's secret, which this server
 * must hold.
 *
 * This asks Meta for each of those facts and turns them into one plain
 * answer. Evidence beats inference: if signed webhooks for the number
 * have actually arrived here, the route works whatever the URLs say.
 *
 * Reference:
 *   https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
 */

import { META_API_BASE, getSubscribedApps, throwMetaError } from './meta-api'
import type { DeliveryRecord } from './webhook-health'

const TIMEOUT_MS = 10_000

export interface WebhookRoute {
  phone_number?: string
  whatsapp_business_account?: string
  application?: string
}

async function graph<T>(path: string, token: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await fetch(`${META_API_BASE}/${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) await throwMetaError(response, `Meta API error: ${response.status}`)
  return (await response.json()) as T
}

const ID = /^\d{1,30}$/

/** Every address Meta holds for this number, most specific first. */
export async function getPhoneWebhookRoute(phoneNumberId: string, accessToken: string): Promise<WebhookRoute> {
  if (!ID.test(phoneNumberId)) throw new Error('Invalid phone number ID')
  const data = await graph<{ webhook_configuration?: WebhookRoute }>(
    `${phoneNumberId}?fields=webhook_configuration`,
    accessToken,
  )
  return data.webhook_configuration ?? {}
}

/** Point this one number's messages at `url`. Meta checks the address
 *  first, with a GET carrying `verifyToken`, and refuses if it fails. */
export async function setPhoneWebhookOverride(args: {
  phoneNumberId: string
  accessToken: string
  url: string
  verifyToken: string
}): Promise<void> {
  if (!ID.test(args.phoneNumberId)) throw new Error('Invalid phone number ID')
  await graph(args.phoneNumberId, args.accessToken, {
    method: 'POST',
    body: { webhook_configuration: { override_callback_uri: args.url, verify_token: args.verifyToken } },
  })
}

/** The Meta app this access token was issued for — the app that
 *  delivers the number's webhooks and signs them with its secret. */
async function getTokenApp(accessToken: string): Promise<{ id: string; name: string } | null> {
  try {
    const data = await graph<{ id?: string; name?: string }>('app', accessToken)
    return data.id && ID.test(data.id) ? { id: data.id, name: data.name ?? '' } : null
  } catch {
    return null
  }
}

interface AppSubscription {
  callbackUrl: string | null
  messages: boolean
  active: boolean
}

/**
 * Reads the app's webhook settings with an app access token made from
 * each secret this server holds. Whichever works is the app's real
 * secret — so this also answers "can this server check that app's
 * signatures?" without the secret ever leaving the server except to Meta.
 */
async function readAppWithSecrets(
  appId: string,
  secrets: readonly string[],
): Promise<{ secretMatches: boolean | null; subscription: AppSubscription | null }> {
  if (!secrets.length) return { secretMatches: null, subscription: null }
  let sawRejection = false
  for (const secret of secrets) {
    let response: Response
    try {
      response = await fetch(`${META_API_BASE}/${appId}/subscriptions`, {
        headers: { Authorization: `Bearer ${appId}|${secret}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      return { secretMatches: null, subscription: null }
    }
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        data?: { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] }[]
      }
      const wa = (data.data ?? []).find((s) => s.object === 'whatsapp_business_account')
      return {
        secretMatches: true,
        subscription: {
          callbackUrl: wa?.callback_url || null,
          messages: !!wa?.fields?.some((f) => f.name === 'messages'),
          active: wa?.active !== false && !!wa,
        },
      }
    }
    const err = (await response.json().catch(() => ({}))) as { error?: { code?: number; type?: string } }
    if (err.error?.code === 190 || err.error?.type === 'OAuthException') sawRejection = true
    else return { secretMatches: null, subscription: null }
  }
  return { secretMatches: sawRejection ? false : null, subscription: null }
}

// ── the verdict ───────────────────────────────────────────────────────

export type DeliveryIssue =
  | 'not_subscribed' // the WhatsApp account is not subscribed to our app
  | 'no_callback' // Meta has no address at all for this number
  | 'elsewhere' // Meta sends this number's messages to another address
  | 'messages_off' // the app is not subscribed to the "messages" field
  | 'no_secret' // this server holds no App Secret, so it refuses everything
  | 'secret_mismatch' // this server's App Secret is not the sending app's

export type DeliveryStatus = 'receiving' | 'waiting' | 'blocked' | 'unknown'

export interface DeliveryFacts {
  ourUrl: string
  /** null when Meta could not be asked. */
  route: WebhookRoute | null
  routeError?: string
  app: { id: string; name: string } | null
  appSubscription: AppSubscription | null
  secretMatchesApp: boolean | null
  secretsConfigured: number
  ourAppOnWaba: boolean | null
  record: DeliveryRecord
}

export interface DeliveryReport {
  status: DeliveryStatus
  issues: DeliveryIssue[]
  /** The first issue is one the "send messages here" button fixes. */
  canFix: boolean
  ourUrl: string
  effectiveUrl: string | null
  via: keyof WebhookRoute | null
  appName: string | null
  routeError: string | null
  lastDeliveredAt: string | null
  since: string
  rejected: DeliveryRecord['rejected']
}

/** Same endpoint, allowing for "www." and a trailing slash. */
export function sameEndpoint(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    const host = (u: URL) => u.host.toLowerCase().replace(/^www\./, '')
    const path = (u: URL) => u.pathname.replace(/\/+$/, '')
    return host(x) === host(y) && path(x) === path(y)
  } catch {
    return false
  }
}

const ROUTING: DeliveryIssue[] = ['not_subscribed', 'no_callback', 'elsewhere', 'messages_off']

export function deliveryVerdict(f: DeliveryFacts): DeliveryReport {
  const route = f.route ?? {}
  const via = (['phone_number', 'whatsapp_business_account', 'application'] as const).find((k) => !!route[k]?.trim()) ?? null
  const effectiveUrl = via ? route[via]!.trim() : null

  let issues: DeliveryIssue[] = []
  if (f.ourAppOnWaba === false) issues.push('not_subscribed')
  if (f.route) {
    if (!effectiveUrl) issues.push('no_callback')
    else if (!sameEndpoint(effectiveUrl, f.ourUrl)) issues.push('elsewhere')
  }
  if (f.appSubscription && (!f.appSubscription.messages || !f.appSubscription.active)) issues.push('messages_off')

  const delivered = f.record.lastDeliveredAt
  const rejectedSince = f.record.rejected && (!delivered || f.record.rejected.at > delivered) ? f.record.rejected : null
  if (f.secretsConfigured === 0) issues.push('no_secret')
  else if (f.secretMatchesApp === false || rejectedSince?.reason === 'mismatch') issues.push('secret_mismatch')

  // Signed webhooks for this number have arrived here: whatever the
  // addresses say, the route works (an alias of this host, say).
  if (delivered) issues = issues.filter((i) => !ROUTING.includes(i))

  const status: DeliveryStatus = delivered && !rejectedSince && issues.length === 0
    ? 'receiving'
    : issues.length > 0
      ? 'blocked'
      : f.route === null
        ? 'unknown'
        : 'waiting'

  return {
    status,
    issues,
    canFix: issues[0] === 'elsewhere' || issues[0] === 'not_subscribed',
    ourUrl: f.ourUrl,
    effectiveUrl,
    via,
    appName: f.app?.name || null,
    routeError: f.routeError ?? null,
    lastDeliveredAt: delivered,
    since: f.record.since,
    rejected: f.record.rejected,
  }
}

/** Asks Meta every question at once; each one may fail on its own. */
export async function diagnoseDelivery(args: {
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
  ourUrl: string
  secrets: readonly string[]
  record: DeliveryRecord
}): Promise<DeliveryReport> {
  const [route, app, subs] = await Promise.allSettled([
    getPhoneWebhookRoute(args.phoneNumberId, args.accessToken),
    getTokenApp(args.accessToken),
    args.wabaId ? getSubscribedApps({ wabaId: args.wabaId, accessToken: args.accessToken }) : Promise.resolve(null),
  ])
  const tokenApp = app.status === 'fulfilled' ? app.value : null
  const appRead = tokenApp ? await readAppWithSecrets(tokenApp.id, args.secrets) : { secretMatches: null, subscription: null }

  let ourAppOnWaba: boolean | null = null
  if (subs.status === 'fulfilled' && subs.value) {
    const ids = subs.value.map((s) => s.whatsapp_business_api_data?.id).filter(Boolean)
    if (subs.value.length === 0) ourAppOnWaba = false
    else if (tokenApp) ourAppOnWaba = ids.includes(tokenApp.id)
  }

  return deliveryVerdict({
    ourUrl: args.ourUrl,
    route: route.status === 'fulfilled' ? route.value : null,
    routeError: route.status === 'rejected' ? (route.reason instanceof Error ? route.reason.message : String(route.reason)) : undefined,
    app: tokenApp,
    appSubscription: appRead.subscription,
    secretMatchesApp: appRead.secretMatches,
    secretsConfigured: args.secrets.length,
    ourAppOnWaba,
    record: args.record,
  })
}

/**
 * This site's own webhook address, for comparing and for the fix. Only a
 * public https host name qualifies — never localhost or a bare IP, which
 * Meta would refuse anyway — so a crafted Host header cannot point a
 * number's messages at an address of the caller's choosing beyond the
 * names this server is reached by.
 */
export function webhookUrlFor(origin: string): string | null {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'https:') return null
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return null
    return `https://${u.host.toLowerCase()}/api/whatsapp/webhook`
  } catch {
    return null
  }
}
