/**
 * Independent security review (A7, final check) — provider write rules
 * added to blockedOutbound in round 7 (3f24396).
 */
import { describe, expect, it } from 'vitest'
import { blockedOutbound } from '@/lib/dev/send-guard'

const STAGING = { APP_ENV: 'staging', NODE_ENV: 'production' }
const stop = (url: string, method = 'POST', env: Record<string, string> = STAGING) => blockedOutbound(url, method, '{}', env, {})

describe('Telegram: every verb and URL form', () => {
  for (const u of [
    'https://api.telegram.org/bot1:AA/setWebhook',
    'https://api.telegram.org/bot1:AA/SETWEBHOOK',
    'https://api.telegram.org/bot1:AA/setWebhook/',
    'https://api.telegram.org/bot1:AA/setWebhook?url=https://evil',
    'https://api.telegram.org/bot1:AA/set%57ebhook',
    'https://api.telegram.org/bot1:AA//setWebhook',
    'https://api.telegram.org/bot1:AA/getMe/../setWebhook',
    'https://API.TELEGRAM.ORG./bot1:AA/deleteWebhook',
    'https://api.telegram.org/bot1:AA/getUpdates',
    'https://api.telegram.org/bot1:AA/logOut',
    'https://api.telegram.org/bot1:AA/close',
    'https://api.telegram.org/bot1:AA/editMessageText',
    'https://api.telegram.org/bot1:AA/banChatMember',
    'https://api.telegram.org/bot1:AA/getMe;setWebhook',
  ]) {
    for (const m of ['GET', 'POST', 'HEAD']) {
      it(`${m} ${u} is stopped`, () => expect(stop(u, m)).not.toBeNull())
    }
  }
  it('reads stay open: getMe, getFile, getWebhookInfo, file download', () => {
    for (const u of ['https://api.telegram.org/bot1:AA/getMe', 'https://api.telegram.org/bot1:AA/getFile', 'https://api.telegram.org/bot1:AA/getWebhookInfo', 'https://api.telegram.org/file/bot1:AA/voice/x.ogg']) {
      expect(stop(u, u.includes('/file/') ? 'GET' : 'POST'), u).toBeNull()
    }
  })
})

describe('Google', () => {
  it('oauth2 token / tokeninfo / userinfo open; revoke stopped', () => {
    expect(stop('https://oauth2.googleapis.com/token')).toBeNull()
    expect(stop('https://oauth2.googleapis.com/tokeninfo')).toBeNull()
    expect(stop('https://openidconnect.googleapis.com/v1/userinfo', 'GET')).toBeNull()
    expect(stop('https://oauth2.googleapis.com/revoke?token=x')).not.toBeNull()
    expect(stop('https://oauth2.googleapis.com/token/../revoke')).not.toBeNull()
    expect(stop('https://oauth2.googleapis.com/tokenx')).not.toBeNull()
  })
  it('writes to any googleapis product are stopped, AI hosts left open', () => {
    for (const u of ['https://sheets.googleapis.com/v4/spreadsheets/a/values:batchUpdate', 'https://www.googleapis.com/calendar/v3/calendars/p/events', 'https://www.googleapis.com/upload/drive/v3/files', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/x/modify', 'https://people.googleapis.com/v1/people:createContact', 'https://storage.googleapis.com/b/o']) {
      expect(stop(u), u).not.toBeNull()
    }
    expect(stop('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).toBeNull()
    expect(stop('https://www.googleapis.com/calendar/v3/freeBusy')).toBeNull()
  })
  it('lookalike hosts do not borrow the open rules', () => {
    expect(stop('https://oauth2.googleapis.com.evil.com/revoke')).toBeNull() // not a provider host at all (tenant/SSRF rules apply elsewhere)
    expect(stop('https://evil-oauth2.googleapis.com/token')).not.toBeNull()
  })
})

describe('Razorpay / PhonePe / SMS / mail', () => {
  for (const [u, m] of [
    ['https://api.razorpay.com/v1/orders', 'POST'],
    ['https://api.razorpay.com/v1/payment_links', 'POST'],
    ['https://api.razorpay.com/v1/payments/pay_1/refund', 'POST'],
    ['https://api.phonepe.com/apis/pg/paylinks/v1/pay', 'POST'],
    ['https://api.phonepe.com/apis/pg/v1/oauth/token/../../paylinks/v1/pay', 'POST'],
    ['https://graph.microsoft.com/v1.0/subscriptions', 'POST'],
    ['https://graph.microsoft.com/v1.0/$batch', 'POST'],
    ['https://api.textbee.dev/api/v1/webhooks', 'POST'],
    ['https://api.sendgrid.com/v3/user/webhooks/parse/settings', 'POST'],
    ['https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers/PN1.json', 'POST'],
  ] as const) {
    it(`${m} ${u} is stopped`, () => expect(stop(u, m)).not.toBeNull())
  }
  it('Razorpay payment read stays open (verify / save-payment)', () => {
    expect(stop('https://api.razorpay.com/v1/payments/pay_1', 'GET')).toBeNull()
  })
})

describe('production unchanged and the explicit switches', () => {
  it('no provider write is touched in production', () => {
    for (const u of ['https://api.telegram.org/bot1:AA/setWebhook', 'https://api.razorpay.com/v1/orders', 'https://oauth2.googleapis.com/revoke', 'https://graph.microsoft.com/v1.0/subscriptions']) {
      expect(stop(u, 'POST', { NODE_ENV: 'production' })).toBeNull()
      expect(stop(u, 'POST', {})).toBeNull()
    }
  })
  it('DEV_ALLOW_SENDING=1 opens everything; DEV_ALLOWED_HOSTS opens only the exact host', () => {
    expect(stop('https://api.razorpay.com/v1/orders', 'POST', { ...STAGING, DEV_ALLOW_SENDING: '1' })).toBeNull()
    const env = { ...STAGING, DEV_ALLOWED_HOSTS: 'api.razorpay.com' }
    expect(stop('https://api.razorpay.com/v1/orders', 'POST', env)).toBeNull()
    expect(stop('https://api.telegram.org/bot1:AA/setWebhook', 'POST', env)).not.toBeNull()
  })
})
