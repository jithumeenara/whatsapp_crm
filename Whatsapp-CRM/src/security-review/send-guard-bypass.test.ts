/**
 * Independent security review (A7, 2026-10) — src/lib/dev/send-guard.ts.
 * Passing tests assert the secure behaviour; `it.fails` documents a gap.
 */
import { describe, expect, it } from 'vitest'
import { blockedSend, isSendProtected, sdkSendBlocked } from '@/lib/dev/send-guard'

const STAGING = { APP_ENV: 'staging', NODE_ENV: 'production' }
const igBody = JSON.stringify({ recipient: { id: '1784' }, message: { text: 'hi' } })

describe('environment decision', () => {
  it('a production server with nothing set is never touched', () => {
    expect(isSendProtected({ NODE_ENV: 'production' })).toBe(false)
    expect(isSendProtected({})).toBe(false)
    expect(blockedSend('https://graph.facebook.com/v21.0/1/messages', 'POST', '{"to":"1"}', { NODE_ENV: 'production' })).toBeNull()
  })
  it('protected names are matched case- and space-insensitively', () => {
    for (const v of ['development', 'DEV', ' Staging ', 'preview', 'test', 'local']) {
      expect(isSendProtected({ APP_ENV: v, NODE_ENV: 'production' }), v).toBe(true)
    }
  })
  it('only the server environment decides (blockedSend takes no request data besides url/method/body)', () => {
    // A body cannot unlock sending: DEV_ALLOW_SENDING is read from env only.
    const body = JSON.stringify({ to: '1', DEV_ALLOW_SENDING: '1', APP_ENV: 'production' })
    expect(blockedSend('https://graph.facebook.com/v21.0/1/messages', 'POST', body, STAGING)).not.toBeNull()
  })
  it('lower-case method and a non-string body are still stopped', () => {
    expect(blockedSend('https://graph.facebook.com/v21.0/1/messages', 'post', new Uint8Array([1]), STAGING)).not.toBeNull()
  })
  it('the SDK path (Twilio / web-push) is stopped on staging', () => {
    expect(sdkSendBlocked('Twilio', ['+15550001111'], STAGING)).toBe(true)
  })
  it('the recipient allow-list does not let a mixed batch through', () => {
    const env = { ...STAGING, DEV_ALLOWED_RECIPIENTS: '919800000001' }
    const body = JSON.stringify({ personalizations: [{ to: [{ email: 'a@b.co' }] }], to: '919800000001' })
    expect(blockedSend('https://api.sendgrid.com/v3/mail/send', 'POST', body, env)).not.toBeNull()
  })
})

describe('channels', () => {
  for (const url of [
    'https://graph.facebook.com/v21.0/123/messages',
    'https://graph.facebook.com/v21.0/me/messages?access_token=x',
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    'https://graph.microsoft.com/v1.0/me/sendMail',
    'https://api.sendgrid.com/v3/mail/send',
    'https://api.telegram.org/botTOKEN/sendMessage',
    'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json',
  ]) {
    it(`stops ${url} on staging`, () => expect(blockedSend(url, 'POST', '{}', STAGING)).not.toBeNull())
  }

  // Was GAP N3 (MEDIUM), fixed in 403f950. Instagram DMs sent with an Instagram-Login token go to
  // graph.INSTAGRAM.com/…/me/messages (whatsapp/send/route.ts:91,
  // instagram/webhook/route.ts:454, flows/meta-send.ts:205,239,545,576,1014).
  // The guard's Meta rule only matches graph.facebook.com, so a dev,
  // preview or staging server pointed at a copy of production data
  // replies to real Instagram customers (inbox, chatbot, flows,
  // comment-to-DM automations). Fix: match graph\.(facebook|instagram)\.com.
  it('stops an Instagram DM (graph.instagram.com/me/messages) on staging', () => {
    expect(blockedSend('https://graph.instagram.com/v21.0/me/messages?access_token=x', 'POST', igBody, STAGING)).not.toBeNull()
  })
})
