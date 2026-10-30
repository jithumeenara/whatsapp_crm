/**
 * Bug (independent review A7, round 6 — R6a / R6b): on a preview / staging
 * server (which runs background jobs against a copy of production data)
 * provider writes that are not a customer message still went out:
 *
 *   - Telegram setWebhook / deleteWebhook re-pointed the PRODUCTION bot's
 *     webhook to staging; deleteMessage deleted real messages;
 *   - TextBee webhook registration and Microsoft Graph subscriptions
 *     re-pointed inbound SMS / mail;
 *   - Google Sheets / Calendar / Drive / Gmail writes edited customers' data;
 *   - Razorpay / PhonePe created real payment links;
 *   - a flow / chatbot HTTP step's GET to a catch hook still fired.
 *
 * Every write to a known provider host is now stopped on a protected
 * server, whatever HTTP verb carries it (Telegram accepts GET for every
 * method). Reads, OAuth / token endpoints needed to connect an account,
 * and AI model calls stay open. Production is untouched.
 */
import { describe, expect, it } from 'vitest'
import { blockedOutbound } from './send-guard'

const STAGING = { APP_ENV: 'staging', NODE_ENV: 'production' }
const PROD_ENVS = [{}, { NODE_ENV: 'production' }, { APP_ENV: 'production', NODE_ENV: 'production' }]
const at = (url: string, method: string, env: Record<string, string> = STAGING, purpose?: 'outbound-action') =>
  blockedOutbound(url, method, '{}', env, purpose ? { purpose } : {})

// host → write that must be stopped
const WRITES: Array<[string, string]> = [
  // Telegram — any verb, any method that is not a read
  ['POST', 'https://api.telegram.org/botT/setWebhook'],
  ['GET', 'https://api.telegram.org/botT/setWebhook?url=https://staging.example/x'],
  ['GET', 'https://api.telegram.org/botT/deleteWebhook'],
  ['POST', 'https://api.telegram.org/botT/deletemessage'],
  ['GET', 'https://api.telegram.org/botT/sendMessage?chat_id=1&text=hi'],
  ['POST', 'https://api.telegram.org/botT/answerCallbackQuery'],
  ['POST', 'https://api.telegram.org/botT/getUpdates'], // consumes updates meant for production
  ['POST', 'https://api.telegram.org/botT/logOut'],
  ['GET', 'https://api.telegram.org/botT/set%57ebhook?url=x'],
  ['POST', 'https://API.TELEGRAM.ORG./botT/setWebhook'],
  ['POST', 'https://api.telegram.org/file/botT/photos/x.jpg'],
  // TextBee
  ['POST', 'https://api.textbee.dev/api/v1/webhooks'],
  ['PATCH', 'https://api.textbee.dev/api/v1/webhooks/abc'],
  ['DELETE', 'https://api.textbee.dev/api/v1/webhooks/abc'],
  ['POST', 'https://api.textbee.dev/api/v1/gateway/devices/d/send-sms'],
  // Microsoft Graph
  ['POST', 'https://graph.microsoft.com/v1.0/subscriptions'],
  ['PATCH', 'https://graph.microsoft.com/v1.0/subscriptions/s1'],
  ['DELETE', 'https://graph.microsoft.com/v1.0/subscriptions/s1'],
  ['POST', 'https://graph.microsoft.com/v1.0/me/messages'], // a draft in a real mailbox
  ['POST', 'https://graph.microsoft.com/v1.0/$batch'],
  // Google
  ['POST', 'https://sheets.googleapis.com/v4/spreadsheets/abc/values:batchUpdate'],
  ['PUT', 'https://sheets.googleapis.com/v4/spreadsheets/abc/values/A1'],
  ['POST', 'https://sheets.googleapis.com/v4/spreadsheets'],
  ['POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none'],
  ['PATCH', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/e1'],
  ['DELETE', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/e1'],
  ['POST', 'https://www.googleapis.com/drive/v3/files'],
  ['POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'],
  ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify'],
  ['POST', 'https://oauth2.googleapis.com/revoke?token=x'], // disconnects the real grant
  ['POST', 'https://people.googleapis.com/v1/people:createContact'],
  ['POST', 'https://WWW.GOOGLEAPIS.COM./calendar/v3/calendars/primary/events'],
  // Payments
  ['POST', 'https://api.razorpay.com/v1/payment_links'],
  ['POST', 'https://api.razorpay.com/v1/orders'],
  ['POST', 'https://api-preprod.phonepe.com/apis/pg-sandbox/paylinks/v1/pay'],
  ['POST', 'https://api.phonepe.com/apis/pg/paylinks/v1/pay'],
  // Already-covered senders: any other write to them too
  ['POST', 'https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers/PN1.json'],
  ['DELETE', 'https://api.sendgrid.com/v3/marketing/contacts'],
  ['POST', 'https://api.msg91.com/api/v5/flow/'],
]

// must keep working on a protected server
const OPEN: Array<[string, string]> = [
  ['POST', 'https://api.telegram.org/botT/getMe'],
  ['POST', 'https://api.telegram.org/botT/getFile'],
  ['POST', 'https://api.telegram.org/botT/getWebhookInfo'],
  ['GET', 'https://api.telegram.org/botT/getChat?chat_id=1'],
  ['GET', 'https://api.telegram.org/file/botT/photos/x.jpg'],
  ['GET', 'https://api.textbee.dev/api/v1/gateway/devices'],
  ['GET', 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages'],
  ['GET', 'https://sheets.googleapis.com/v4/spreadsheets/abc/values/A1'],
  ['GET', 'https://www.googleapis.com/calendar/v3/calendars/primary/events'],
  ['POST', 'https://www.googleapis.com/calendar/v3/freeBusy'], // a read sent as POST
  ['POST', 'https://oauth2.googleapis.com/token'],
  ['GET', 'https://oauth2.googleapis.com/tokeninfo?access_token=x'],
  ['GET', 'https://openidconnect.googleapis.com/v1/userinfo'],
  ['POST', 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/oauth2/v2.0/token'],
  ['POST', 'https://accounts.google.com/o/oauth2/token'],
  ['POST', 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'],
  ['POST', 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'],
  ['GET', 'https://api.razorpay.com/v1/payments/pay_1'],
  ['GET', 'https://api.msg91.com/api/v5/balance?type=4'],
  // AI model providers: a paid call, no customer-visible state changes
  ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'],
  ['POST', 'https://texttospeech.googleapis.com/v1/text:synthesize'],
  ['POST', 'https://api.openai.com/v1/chat/completions'],
  ['POST', 'https://api.anthropic.com/v1/messages'],
  ['POST', 'https://api.deepseek.com/chat/completions'],
]

describe('provider writes are stopped on a protected server (R6a)', () => {
  for (const [m, u] of WRITES) {
    it(`stops ${m} ${u}`, () => {
      const hit = at(u, m)
      expect(hit).not.toBeNull()
      expect(hit!.host).toBe(new URL(u).hostname.toLowerCase().replace(/\.$/, ''))
    })
  }
  for (const [m, u] of OPEN) {
    it(`leaves ${m} ${u} open`, () => expect(at(u, m)).toBeNull())
  }
  it('production is untouched for every write', () => {
    for (const env of PROD_ENVS) for (const [m, u] of WRITES) expect(blockedOutbound(u, m, '{}', env), `${m} ${u}`).toBeNull()
  })
  it('DEV_ALLOW_SENDING=1 lets every provider write out', () => {
    for (const [m, u] of WRITES) expect(at(u, m, { ...STAGING, DEV_ALLOW_SENDING: '1' }), `${m} ${u}`).toBeNull()
  })
  it('DEV_ALLOWED_HOSTS lets a provider write out to that exact host only', () => {
    const env = { ...STAGING, DEV_ALLOWED_HOSTS: 'api.razorpay.com' }
    expect(at('https://api.razorpay.com/v1/orders', 'POST', env)).toBeNull()
    expect(at('https://api-preprod.phonepe.com/apis/pg-sandbox/paylinks/v1/pay', 'POST', env)).not.toBeNull()
  })
  it('a lookalike host is not treated as a provider', () => {
    expect(at('https://api.telegram.org.evil.example/botT/setWebhook', 'POST')).toBeNull()
    expect(at('https://evilgoogleapis.com/x', 'POST')).toBeNull()
  })
})

describe('the stopped call gets a believable answer', () => {
  const body = async (m: string, u: string) => {
    const r = at(u, m)!.reply()
    expect(r.ok).toBe(true)
    return r.status === 204 ? null : r.json()
  }
  it('Telegram: ok + result', async () => {
    expect(await body('POST', 'https://api.telegram.org/botT/setWebhook')).toMatchObject({ ok: true, result: true })
    expect(await body('GET', 'https://api.telegram.org/botT/sendMessage?chat_id=1')).toMatchObject({ ok: true, result: { message_id: expect.any(Number) } })
  })
  it('Razorpay payment link: id + short_url', async () => {
    expect(await body('POST', 'https://api.razorpay.com/v1/payment_links')).toMatchObject({ id: expect.any(String), short_url: expect.stringMatching(/^https:\/\//) })
  })
  it('PhonePe link: orderId + https paylinkUrl', async () => {
    expect(await body('POST', 'https://api.phonepe.com/apis/pg/paylinks/v1/pay')).toMatchObject({ orderId: expect.any(String), paylinkUrl: expect.stringMatching(/^https:\/\//) })
  })
  it('Microsoft Graph subscription: id + expiry', async () => {
    expect(await body('POST', 'https://graph.microsoft.com/v1.0/subscriptions')).toMatchObject({ id: expect.any(String), expirationDateTime: expect.any(String) })
  })
  it('Google / TextBee: an id', async () => {
    expect(await body('POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events')).toMatchObject({ id: expect.any(String) })
    expect(await body('POST', 'https://api.textbee.dev/api/v1/webhooks')).toMatchObject({ data: { _id: expect.any(String) } })
  })
})

describe('outbound actions: GET is stopped too (R6b)', () => {
  it('a GET / HEAD outbound action is stopped on staging', () => {
    for (const m of ['GET', 'HEAD']) expect(at('https://hooks.zapier.com/hooks/catch/1/x?phone=1', m, STAGING, 'outbound-action'), m).not.toBeNull()
  })
  it('unless the host is in DEV_ALLOWED_HOSTS', () => {
    expect(at('https://webhook.site/x', 'GET', { ...STAGING, DEV_ALLOWED_HOSTS: 'webhook.site' }, 'outbound-action')).toBeNull()
  })
  it('a plain GET without the purpose flag (imports, integrations) is left alone', () => {
    expect(at('https://hooks.zapier.com/hooks/catch/1/x', 'GET')).toBeNull()
  })
  it('production is untouched', () => {
    for (const env of PROD_ENVS) expect(blockedOutbound('https://hooks.zapier.com/x', 'GET', undefined, env, { purpose: 'outbound-action' })).toBeNull()
  })
})
