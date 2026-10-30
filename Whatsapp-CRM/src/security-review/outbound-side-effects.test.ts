/**
 * Independent security review (A7, round 6) — blockedOutbound
 * (src/lib/dev/send-guard.ts, fa7fc4a): can a preview / staging server
 * still cause an outbound side effect? Passing tests assert the secure
 * behaviour; `it.fails` documents a confirmed remaining gap.
 *
 * Every call here is what the PATCHED GLOBAL FETCH asks (no purpose), or
 * what safeFetch asks for a caller that passes purpose 'outbound-action'.
 */
import { describe, expect, it } from 'vitest'
import { blockedOutbound } from '@/lib/dev/send-guard'

const STAGING = { APP_ENV: 'staging', NODE_ENV: 'production' }
const PREVIEW = { APP_ENV: 'preview', NODE_ENV: 'production' }
const PROD = { NODE_ENV: 'production' }
const stop = (url: string, method = 'POST', env: Record<string, string> = STAGING, purpose?: 'outbound-action') =>
  blockedOutbound(url, method, '{}', env, purpose ? { purpose } : {})

describe('production is untouched', () => {
  for (const [url, m] of [
    ['https://graph.facebook.com/v21.0/123/subscribed_apps', 'POST'],
    ['https://hooks.zapier.com/hooks/catch/1/x', 'POST'],
    ['https://graph.facebook.com/v21.0/1/messages', 'POST'],
    ['https://api.telegram.org/botT/setWebhook', 'POST'],
  ]) {
    it(`${m} ${url} → null in production`, () => {
      expect(blockedOutbound(url, m, '{}', PROD, { purpose: 'outbound-action' })).toBeNull()
      expect(blockedOutbound(url, m, '{}', {}, {})).toBeNull()
    })
  }
})

describe('Meta writes', () => {
  for (const [url, m] of [
    ['https://graph.facebook.com/v21.0/123/subscribed_apps', 'POST'],
    ['https://graph.facebook.com/v21.0/123/register', 'POST'],
    ['https://graph.facebook.com/v21.0/123/whatsapp_business_profile', 'POST'],
    ['https://graph.facebook.com/v21.0/123/message_templates', 'POST'],
    ['https://graph.facebook.com/v21.0/123', 'DELETE'],
    ['https://graph.facebook.com/v21.0/123?method=delete', 'GET'],
    ['https://graph.facebook.com/v21.0/123?method=POST&x=1', 'GET'],
    ['https://graph.facebook.com/', 'POST'], // batch
    ['https://GRAPH.FACEBOOK.COM./v21.0/123/subscribed_apps', 'POST'],
    ['https://graph.instagram.com/v21.0/me/messenger_profile', 'POST'],
    ['https://graph-video.facebook.com/v21.0/1/videos', 'POST'],
    ['https://rupload.facebook.com/whatsapp-business-api/1', 'POST'],
    ['https://graph.facebook.com/v21.0/oauth/access_token/../../123/subscribed_apps', 'POST'], // dot segments normalised by URL
    ['https://graph.facebook.com/v21.0/oauth%2Faccess_token', 'POST'],
    ['https://graph.facebook.com/v21.0/oauth/access_token_x', 'POST'],
  ] as const) {
    it(`stops ${m} ${url}`, () => expect(stop(url, m)).not.toBeNull())
  }
  it('connect endpoints (OAuth / debug_token / refresh) stay open, and none of them is a write', () => {
    for (const u of [
      'https://graph.facebook.com/v21.0/oauth/access_token?code=x',
      'https://graph.facebook.com/oauth/access_token',
      'https://graph.facebook.com/v21.0/debug_token?input_token=x',
      'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token',
      'https://graph.instagram.com/access_token?grant_type=ig_exchange_token',
    ]) {
      expect(stop(u, 'GET'), u).toBeNull()
    }
  })
  it('reads stay open', () => {
    expect(stop('https://graph.facebook.com/v21.0/123?fields=id', 'GET')).toBeNull()
  })
})

describe('DEV_ALLOWED_HOSTS — exact match, server env only, never unlocks a message', () => {
  const env = { ...STAGING, DEV_ALLOWED_HOSTS: 'webhook.site, graph.facebook.com' }
  it('exact host passes', () => {
    expect(stop('https://webhook.site/abc', 'POST', env, 'outbound-action')).toBeNull()
    expect(stop('https://WEBHOOK.SITE./abc', 'POST', env, 'outbound-action')).toBeNull()
  })
  it('suffix / prefix / subdomain lookalikes are still stopped', () => {
    for (const u of ['https://evil-webhook.site/x', 'https://webhook.site.evil.com/x', 'https://a.webhook.site/x', 'https://webhook.sitex/x']) {
      expect(stop(u, 'POST', env, 'outbound-action'), u).not.toBeNull()
    }
  })
  it('allowing graph.facebook.com never lets a customer message through', () => {
    expect(stop('https://graph.facebook.com/v21.0/1/messages', 'POST', env)).not.toBeNull()
  })
  it('a request cannot add hosts: only the env argument is read', () => {
    const url = 'https://hooks.zapier.com/x?DEV_ALLOWED_HOSTS=hooks.zapier.com&DEV_ALLOW_SENDING=1'
    expect(stop(url, 'POST', STAGING, 'outbound-action')).not.toBeNull()
  })
})

describe('tenant-configured outbound actions', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`${m} to a tenant URL is stopped on preview`, () => expect(stop('https://hooks.zapier.com/hooks/catch/1/x', m, PREVIEW, 'outbound-action')).not.toBeNull())
  }
  // GAP (LOW): GET / HEAD with purpose 'outbound-action' are let through
  // ("reads"). But a flow / chatbot HTTP step's GET is not an import: many
  // trigger endpoints accept GET (Zapier/Make catch hooks, IFTTT, SMS
  // gateways with GET send URLs, e.g. …/sendsms?to=…&text=…). A staging
  // server running a flow against a production-data copy can still fire
  // them. Fix: in http-request-node, also stop GETs (or GETs with a query
  // string) unless the host is in DEV_ALLOWED_HOSTS.
  it('a flow HTTP GET to a catch-hook / send URL is stopped on staging', () => {
    expect(stop('https://hooks.zapier.com/hooks/catch/1/x?phone=919800000001&msg=hi', 'GET', STAGING, 'outbound-action')).not.toBeNull()
  })
})

describe('other providers’ write APIs reached through the patched global fetch (no purpose)', () => {
  // GAP (MEDIUM): only customer-message endpoints and Meta writes are
  // stopped on the global-fetch path. Writes to other providers still go
  // out from preview/staging — and on preview/staging background jobs RUN
  // (server.ts stops them only for APP_ENV=development), so the sweeps do
  // these by themselves against a production-data copy:
  //  - Telegram setWebhook / deleteWebhook (lib/telegram/api.ts:88-93):
  //    re-points the PRODUCTION bot's webhook to the staging server, which
  //    then receives every customer's Telegram message;
  //  - TextBee webhook register/patch/delete (messaging/channels/sms.ts:219-250)
  //    and Microsoft Graph /subscriptions (email/microsoft/graph.ts:185-207):
  //    same re-pointing of inbound SMS / mail;
  //  - Google Sheets two-way writes (google/sheets.ts), Calendar
  //    create/patch/delete (google/calendar.ts): edits customers' real
  //    sheets and calendars;
  //  - Telegram deleteMessage (telegram/inbound.ts:166);
  //  - Razorpay / PhonePe payment-link creation (real links, notify off).
  // Fix: extend blockedOutbound's global-fetch rule to every non-GET to
  // these provider hosts (api.telegram.org except getMe/getFile/getUpdates,
  // sheets.googleapis.com, www.googleapis.com/calendar, graph.microsoft.com,
  // api.textbee.dev, api.razorpay.com, PhonePe hosts), or default-deny every
  // non-GET from a protected server except an explicit allow-list.
  for (const [what, url, m] of [
    ['Telegram setWebhook', 'https://api.telegram.org/botT/setWebhook', 'POST'],
    ['Telegram deleteWebhook', 'https://api.telegram.org/botT/deleteWebhook', 'POST'],
    ['Telegram deleteMessage', 'https://api.telegram.org/botT/deleteMessage', 'POST'],
    ['Google Sheets write', 'https://sheets.googleapis.com/v4/spreadsheets/abc/values:batchUpdate', 'POST'],
    ['Google Calendar event', 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none', 'POST'],
    ['Microsoft Graph subscription', 'https://graph.microsoft.com/v1.0/subscriptions', 'POST'],
    ['TextBee webhook registration', 'https://api.textbee.dev/api/v1/webhooks', 'POST'],
    ['Razorpay payment link', 'https://api.razorpay.com/v1/payment_links', 'POST'],
  ] as const) {
    it(`${what} is stopped on staging`, () => expect(stop(url, m)).not.toBeNull())
  }
})
