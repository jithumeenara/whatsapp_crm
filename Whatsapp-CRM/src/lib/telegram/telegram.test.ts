import { describe, expect, it } from 'vitest'
import { displayName, parseUpdate } from './parse'
import { buttonFor, inlineKeyboard, signStartPayload, verifyStartPayload } from './links'

const person = { id: 5123456789, is_bot: false, first_name: 'Jithu', last_name: 'L R', username: 'jithulr', language_code: 'ml' }

describe('reading Telegram updates', () => {
  it('a private text message', () => {
    const e = parseUpdate({ update_id: 10, message: { message_id: 7, from: person, chat: { id: 5123456789, type: 'private' }, text: 'Hello' } })
    expect(e).toMatchObject({ kind: 'message', chatId: '5123456789', messageId: 7, text: 'Hello', startPayload: null, contact: null })
    if (e.kind === 'message') expect(displayName(e.from)).toBe('Jithu L R')
  })

  it('/start with and without a payload', () => {
    const a = parseUpdate({ update_id: 1, message: { message_id: 1, from: person, chat: { id: 1, type: 'private' }, text: '/start cABC_def-1' } })
    expect(a.kind === 'message' && a.startPayload).toBe('cABC_def-1')
    const b = parseUpdate({ update_id: 2, message: { message_id: 2, from: person, chat: { id: 1, type: 'private' }, text: '/start' } })
    expect(b.kind === 'message' && b.startPayload).toBe('')
  })

  it('a shared number is "own" only when it is the sender\'s own account', () => {
    const own = parseUpdate({ update_id: 3, message: { message_id: 3, from: person, chat: { id: 5123456789, type: 'private' }, contact: { phone_number: '+919946000000', user_id: 5123456789 } } })
    expect(own.kind === 'message' && own.contact).toEqual({ phone: '+919946000000', ownNumber: true })
    const someoneElse = parseUpdate({ update_id: 4, message: { message_id: 4, from: person, chat: { id: 5123456789, type: 'private' }, contact: { phone_number: '+919847000000', user_id: 999 } } })
    expect(someoneElse.kind === 'message' && someoneElse.contact?.ownNumber).toBe(false)
  })

  it('a photo takes the largest size; the caption is the text', () => {
    const e = parseUpdate({ update_id: 5, message: { message_id: 5, from: person, chat: { id: 1, type: 'private' }, caption: 'my id', photo: [{ file_id: 'small' }, { file_id: 'big', file_size: 900 }] } })
    expect(e.kind === 'message' && e.media).toMatchObject({ kind: 'image', fileId: 'big' })
    expect(e.kind === 'message' && e.text).toBe('my id')
  })

  it('ignores groups, channels, other bots and edits — the Inbox never fills with strangers', () => {
    expect(parseUpdate({ update_id: 6, message: { message_id: 1, from: person, chat: { id: -100, type: 'group' }, text: 'hi' } }).kind).toBe('ignored')
    expect(parseUpdate({ update_id: 7, channel_post: { message_id: 1, chat: { id: -100, type: 'channel' }, text: 'x' } }).kind).toBe('ignored')
    expect(parseUpdate({ update_id: 8, message: { message_id: 1, from: { ...person, is_bot: true }, chat: { id: 1, type: 'private' }, text: 'x' } }).kind).toBe('ignored')
    expect(parseUpdate({ update_id: 9, edited_message: { message_id: 1 } }).kind).toBe('ignored')
  })

  it('a button press', () => {
    const e = parseUpdate({ update_id: 11, callback_query: { id: 'q1', from: person, data: 'opt_1', message: { message_id: 9, chat: { id: 5123456789, type: 'private' } } } })
    expect(e).toMatchObject({ kind: 'button', callbackQueryId: 'q1', data: 'opt_1', messageId: 9 })
  })

  it('Telegram Business: the customer\'s message is taken, the business owner\'s own is not', () => {
    const customer = parseUpdate({ update_id: 12, business_message: { business_connection_id: 'bc1', message_id: 1, from: person, chat: { id: 5123456789, type: 'private' }, text: 'price?' } })
    expect(customer).toMatchObject({ kind: 'message', businessConnectionId: 'bc1' })
    const owner = parseUpdate({ update_id: 13, business_message: { business_connection_id: 'bc1', message_id: 2, from: { id: 42, first_name: 'Owner' }, chat: { id: 5123456789, type: 'private' }, text: 'sure' } })
    expect(owner.kind).toBe('ignored')
    expect(parseUpdate({ update_id: 14, business_connection: { id: 'bc1', user: { id: 42, first_name: 'Owner' }, is_enabled: true } })).toMatchObject({ kind: 'business_connection', connectionId: 'bc1', enabled: true })
  })
})

describe('start links', () => {
  const id = '6f1c2a40-1111-4b5e-9c3d-000000000001'
  it('round-trips a contact id within Telegram\'s 64-character limit', () => {
    const p = signStartPayload(id, 'secret-A')
    expect(p.length).toBeLessThanOrEqual(64)
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifyStartPayload(p, 'secret-A')).toBe(id)
  })
  it('refuses a payload signed with another secret, or edited', () => {
    const p = signStartPayload(id, 'secret-A')
    expect(verifyStartPayload(p, 'secret-B')).toBeNull()
    expect(verifyStartPayload(p.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 'secret-A')).toBeNull()
    expect(verifyStartPayload('hello', 'secret-A')).toBeNull()
  })
})

describe('buttons', () => {
  it('short ids go as they are, long ones as a hash that turns back', () => {
    const long = 'reply_' + 'x'.repeat(80)
    const { keyboard, meta } = inlineKeyboard([{ id: 'yes', title: 'Yes' }, { id: long, title: 'Long one' }])
    expect(keyboard[0][0]).toEqual({ text: 'Yes', callback_data: 'yes' })
    expect(Buffer.byteLength(keyboard[1][0].callback_data)).toBeLessThanOrEqual(64)
    expect(buttonFor(keyboard[1][0].callback_data, meta)).toEqual({ id: long, title: 'Long one' })
    expect(buttonFor('x:unknown', meta)).toBeNull()
  })
})
