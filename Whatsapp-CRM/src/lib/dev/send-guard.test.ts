import { describe, expect, it } from 'vitest'
import { blockedSend, isDevelopment, recipientsOf } from './send-guard'

const DEV = { APP_ENV: 'development' }
const WA = 'https://graph.facebook.com/v21.0/1234567890/messages'
const waBody = (to: string) => JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'hi' } })

describe('nothing leaves a development machine', () => {
  it('is off on any server that does not say development — production keeps sending', () => {
    expect(isDevelopment({})).toBe(false)
    expect(isDevelopment({ NODE_ENV: 'development' })).toBe(false)
    expect(blockedSend(WA, 'POST', waBody('919847012345'), {})).toBeNull()
    expect(blockedSend(WA, 'POST', waBody('919847012345'), { APP_ENV: 'production' })).toBeNull()
  })

  it('stops every channel’s send in development, and answers like the provider would', async () => {
    const urls = [
      WA,
      'https://graph.facebook.com/v21.0/me/messages?access_token=x',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'https://graph.microsoft.com/v1.0/me/sendMail',
      'https://graph.microsoft.com/v1.0/me/messages/abc/reply',
      'https://api.sendgrid.com/v3/mail/send',
      'https://api.msg91.com/api/v2/sendsms',
    ]
    for (const u of urls) expect(blockedSend(u, 'POST', '{}', DEV), u).not.toBeNull()
    const res = blockedSend(WA, 'POST', waBody('919847012345'), DEV)!.reply()
    const json = (await res.json()) as { messages: Array<{ id: string }> }
    expect(json.messages[0].id).toMatch(/^wamid\.DEV_BLOCKED_/)
  })

  it('stops Telegram sends but lets the bot connect', async () => {
    const tg = (m: string) => `https://api.telegram.org/bot123:ABC/${m}`
    for (const m of ['sendMessage', 'sendPhoto', 'sendDocument', 'copyMessage', 'forwardMessage']) {
      expect(blockedSend(tg(m), 'POST', '{}', DEV), m).not.toBeNull()
    }
    for (const m of ['getMe', 'setWebhook', 'getFile', 'answerCallbackQuery']) {
      expect(blockedSend(tg(m), 'POST', '{}', DEV), m).toBeNull()
    }
    const json = (await blockedSend(tg('sendMessage'), 'POST', '{}', DEV)!.reply().json()) as { ok: boolean; result: { message_id: number } }
    expect(json.ok).toBe(true)
    expect(typeof json.result.message_id).toBe('number')
  })

  it('lets reads and everything else through', () => {
    expect(blockedSend(WA, 'GET', undefined, DEV)).toBeNull()
    expect(blockedSend('https://graph.facebook.com/v21.0/1234567890/message_templates', 'POST', '{}', DEV)).toBeNull()
    expect(blockedSend('https://generativelanguage.googleapis.com/v1/models', 'POST', '{}', DEV)).toBeNull()
  })

  it('sends to the developer’s own number, and only that', () => {
    const env = { ...DEV, DEV_ALLOWED_RECIPIENTS: '+91 98470 12345, me@x.com' }
    expect(blockedSend(WA, 'POST', waBody('919847012345'), env)).toBeNull()
    expect(blockedSend(WA, 'POST', waBody('919999999999'), env)).not.toBeNull()
    expect(blockedSend(WA, 'POST', waBody('919847012345'), { ...DEV, DEV_ALLOW_SENDING: '1' })).toBeNull()
  })

  it('reads who a message is for', () => {
    expect(recipientsOf(waBody('+91 98470-12345'))).toEqual(['919847012345'])
    expect(recipientsOf(JSON.stringify({ recipient: { id: '555' } }))).toEqual(['555'])
    expect(recipientsOf(JSON.stringify({ message: { toRecipients: [{ emailAddress: { address: 'A@B.com' } }] } }))).toEqual(['a@b.com'])
  })
})
