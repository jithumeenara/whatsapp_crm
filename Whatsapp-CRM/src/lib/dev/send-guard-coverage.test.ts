import { describe, expect, it, vi } from 'vitest'
import { blockedSend } from './send-guard'

/**
 * Bug (security audit 2026-10): the send guard only knew APP_ENV=development,
 * so a preview/staging server or a test run pointed at a real database
 * sent real WhatsApp/SMS/email to customers. And it only knew a handful of
 * endpoints: Meta marketing messages, outbound calls, Conversions API /
 * custom-audience uploads, ad creation, Twilio, Google RCS and FCM all went
 * straight out.
 */

const WA = 'https://graph.facebook.com/v21.0/1234567890/messages'

describe('send guard — which servers it protects', () => {
  it('blocks in test, preview and staging, decided by the server environment only', () => {
    for (const env of [
      { APP_ENV: 'test' },
      { APP_ENV: 'preview' },
      { APP_ENV: 'Staging' },
      { APP_ENV: 'local' },
      { NODE_ENV: 'test' },
      { VITEST: 'true' },
    ]) {
      expect(blockedSend(WA, 'POST', '{}', env), JSON.stringify(env)).not.toBeNull()
    }
  })

  it('production stays unaffected', () => {
    for (const env of [{}, { APP_ENV: 'production' }, { NODE_ENV: 'production' }, { APP_ENV: 'prod', NODE_ENV: 'production' }]) {
      expect(blockedSend(WA, 'POST', '{}', env), JSON.stringify(env)).toBeNull()
    }
  })
})

describe('send guard — every provider that reaches a customer', () => {
  const STAGING = { APP_ENV: 'staging' }
  const blocked = [
    // Meta marketing messages (broadcast templates via the MM API)
    'https://graph.facebook.com/v21.0/1234567890/marketing_messages',
    // WhatsApp outbound calls
    'https://graph.facebook.com/v21.0/1234567890/calls',
    // Conversions API / CAPI for business messaging — customer PII to Meta
    'https://graph.facebook.com/v21.0/998877/events',
    // Custom audiences: create, and upload customers into one
    'https://graph.facebook.com/v21.0/act_123/customaudiences',
    'https://graph.facebook.com/v21.0/555666/users',
    // Ads, campaigns, ad sets, creatives
    'https://graph.facebook.com/v21.0/act_123/campaigns',
    'https://graph.facebook.com/v21.0/act_123/adsets',
    'https://graph.facebook.com/v21.0/act_123/ads',
    'https://graph.facebook.com/v21.0/act_123/adcreatives',
    // Twilio SMS / RCS / calls over REST
    'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
    'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json',
    // Google RCS Business Messaging
    'https://rcsbusinessmessaging.googleapis.com/v1/phones/+919847012345/agentMessages?messageId=x',
    // Firebase Cloud Messaging
    'https://fcm.googleapis.com/v1/projects/p/messages:send',
    'https://fcm.googleapis.com/fcm/send',
  ]
  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(blockedSend(url, 'POST', '{}', STAGING)).not.toBeNull()
    })
  }

  it('answers each with a provider-shaped success', async () => {
    const tw = await blockedSend(blocked[9], 'POST', '{}', STAGING)!.reply().json() as { sid: string; status: string }
    expect(tw.sid).toMatch(/^SM/)
    const mm = await blockedSend(blocked[0], 'POST', '{}', STAGING)!.reply().json() as { messages: Array<{ id: string }> }
    expect(mm.messages[0].id).toMatch(/DEV_BLOCKED/)
  })

  it('still lets reads and configuration through', () => {
    expect(blockedSend('https://graph.facebook.com/v21.0/act_123/campaigns', 'GET', undefined, STAGING)).toBeNull()
    expect(blockedSend('https://graph.facebook.com/v21.0/1234567890/register', 'POST', '{}', STAGING)).toBeNull()
    expect(blockedSend('https://api.twilio.com/2010-04-01/Accounts/AC123.json', 'GET', undefined, STAGING)).toBeNull()
  })
})

describe('send guard — installed on fetch, no provider call leaves a test run', () => {
  it('answers every customer-facing send itself and never calls the network', async () => {
    const { installDevSendGuard } = await import('./send-guard')
    const original = globalThis.fetch
    const network = vi.fn(async () => new Response('real'))
    globalThis.fetch = network as unknown as typeof fetch
    try {
      installDevSendGuard()
      const sends = [
        WA, // WhatsApp Cloud API
        'https://graph.facebook.com/v21.0/me/messages?access_token=x', // Messenger / Instagram
        'https://graph.facebook.com/v21.0/1234567890/marketing_messages', // broadcasts (MM API)
        'https://graph.facebook.com/v21.0/act_1/campaigns', // Marketing API
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', // Gmail
        'https://graph.microsoft.com/v1.0/me/sendMail', // Outlook
        'https://api.sendgrid.com/v3/mail/send', // SendGrid
        'https://api.msg91.com/api/v2/sendsms', // MSG91
        'https://api.textbee.dev/api/v1/gateway/send-sms', // TextBee
        'https://api.telegram.org/bot1:A/sendMessage', // Telegram
        'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json', // Twilio (REST)
        'https://rcsbusinessmessaging.googleapis.com/v1/phones/+91984/agentMessages', // Google RCS
        'https://fcm.googleapis.com/v1/projects/p/messages:send', // FCM
      ]
      for (const url of sends) {
        const res = await fetch(url, { method: 'POST', body: '{}' })
        expect(res.ok, url).toBe(true)
      }
      expect(network).not.toHaveBeenCalled()
      // Reads still go out.
      await fetch('https://graph.facebook.com/v21.0/123?fields=id')
      expect(network).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('send guard — SDK sends (Twilio/axios, web-push/https)', () => {
  it('stops them outside production and lets production send', async () => {
    const { sdkSendBlocked } = await import('./send-guard')
    expect(sdkSendBlocked('push', ['x'], { VITEST: 'true' })).toBe(true)
    expect(sdkSendBlocked('push', ['x'], { APP_ENV: 'preview' })).toBe(true)
    expect(sdkSendBlocked('push', ['x'], { NODE_ENV: 'production' })).toBe(false)
    expect(sdkSendBlocked('sms', ['+91 98470 12345'], { APP_ENV: 'staging', DEV_ALLOWED_RECIPIENTS: '919847012345' })).toBe(false)
  })
})
