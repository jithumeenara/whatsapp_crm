import { describe, expect, it } from 'vitest'
import { blockedSend } from './send-guard'

/**
 * N3 (security review 2026-10): Instagram DMs sent with an Instagram-Login
 * token go to graph.instagram.com, which the guard did not match, so a
 * staging server replied to real Instagram customers.
 *
 * One case per outbound messaging host used in src/, with the URL shape the
 * sending code actually builds (grep of every send call site):
 *   graph.facebook.com     lib/whatsapp/meta-api.ts, flows/meta-send.ts, facebook webhook
 *   graph.instagram.com    whatsapp/send/route.ts, instagram/webhook/route.ts, flows/meta-send.ts
 *   gmail.googleapis.com   lib/google/gmail.ts ('/messages/send')
 *   graph.microsoft.com    lib/email/microsoft/graph.ts ('/me/messages/{id}/send', sendMail)
 *   api.sendgrid.com       lib/messaging/channels/email.ts
 *   api.msg91.com          lib/messaging/channels/sms.ts (v2/sendsms)
 *   api.textbee.dev        lib/messaging/channels/sms.ts (gateway/send-sms, devices/{id}/send-sms)
 *   api.telegram.org       lib/telegram/api.ts (bot{token}/send*, copyMessage, forwardMessage)
 *   api.twilio.com         Twilio REST (SDK path uses sdkSendBlocked)
 *   rcsbusinessmessaging.googleapis.com, fcm.googleapis.com
 */
const STAGING = { APP_ENV: 'staging', NODE_ENV: 'production' }

const SENDS: Array<[string, string]> = [
  ['WhatsApp', 'https://graph.facebook.com/v21.0/1234567890/messages'],
  ['Messenger', 'https://graph.facebook.com/v21.0/me/messages?access_token=x'],
  ['Instagram (Instagram Login)', 'https://graph.instagram.com/v21.0/me/messages?access_token=x'],
  ['Instagram (Instagram Login), no version', 'https://graph.instagram.com/me/messages'],
  ['Gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'],
  ['Outlook draft send', 'https://graph.microsoft.com/v1.0/me/messages/AAMk%3D/send'],
  ['Outlook sendMail', 'https://graph.microsoft.com/v1.0/me/sendMail'],
  ['SendGrid', 'https://api.sendgrid.com/v3/mail/send'],
  ['MSG91', 'https://api.msg91.com/api/v2/sendsms'],
  ['TextBee', 'https://api.textbee.dev/api/v1/gateway/send-sms'],
  ['TextBee device', 'https://api.textbee.dev/api/v1/gateway/devices/dev1/send-sms'],
  ['Telegram text', 'https://api.telegram.org/bot123:abc/sendMessage'],
  ['Telegram media group', 'https://api.telegram.org/bot123:abc/sendMediaGroup'],
  ['Telegram copy', 'https://api.telegram.org/bot123:abc/copyMessage'],
  ['Twilio', 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json'],
  ['Google RCS', 'https://rcsbusinessmessaging.googleapis.com/v1/phones/+15550001111/agentMessages'],
  ['FCM', 'https://fcm.googleapis.com/v1/projects/p/messages:send'],
]

describe('send guard — every outbound messaging host', () => {
  for (const [name, url] of SENDS) {
    it(`stops ${name} on staging`, () => {
      expect(blockedSend(url, 'POST', '{"to":"15550001111"}', STAGING)).not.toBeNull()
    })
    it(`leaves ${name} alone in production`, () => {
      expect(blockedSend(url, 'POST', '{"to":"15550001111"}', { NODE_ENV: 'production' })).toBeNull()
    })
  }

  it('an Instagram DM is answered like a Meta send, so callers carry on', async () => {
    const hit = blockedSend('https://graph.instagram.com/v21.0/me/messages', 'POST', '{}', STAGING)
    const body = (await hit!.reply().json()) as { message_id: string }
    expect(body.message_id).toMatch(/DEV_BLOCKED/)
  })

  it('Instagram reads stay allowed (profile, media)', () => {
    expect(blockedSend('https://graph.instagram.com/v21.0/me?fields=id', 'GET', undefined, STAGING)).toBeNull()
    expect(blockedSend('https://graph.instagram.com/v21.0/123/media', 'GET', undefined, STAGING)).toBeNull()
  })

  it('a lookalike host is not mistaken for Instagram', () => {
    expect(blockedSend('https://graph.instagram.com.evil.example/me/messages', 'POST', '{}', STAGING)).toBeNull()
  })
})
