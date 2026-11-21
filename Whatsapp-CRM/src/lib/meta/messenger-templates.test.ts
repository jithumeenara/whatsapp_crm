import { describe, expect, it } from 'vitest'
import { checkParams, checkTemplate, renderTemplate } from './messenger-templates'

// Messenger utility templates: every field checked before it reaches Meta.

describe('a new template', () => {
  it('a good one: name, language and numbered blanks', () => {
    expect(checkTemplate({ name: 'order_update', language: 'en_US', body: 'Hi {{1}}, your order {{2}} has shipped.' }))
      .toEqual({ ok: true, name: 'order_update', language: 'en_US', body: 'Hi {{1}}, your order {{2}} has shipped.', params: 2 })
  })
  it.each([
    [{ name: 'Order Update', body: 'x' }, /small letters/],
    [{ name: 'x', language: 'english', body: 'x' }, /language code/],
    [{ name: 'x', body: '' }, /Write/],
    [{ name: 'x', body: 'y'.repeat(1025) }, /1024/],
    [{ name: 'x', body: 'Hi {{1}} and {{3}} ok' }, /in order/],
    [{ name: 'x', body: 'Hi {{name}} ok' }, /look like/],
    [{ name: 'x', body: '{{1}} is ready' }, /start or end/],
    [{ name: 'x', body: { a: 1 } }, /Write/],
  ])('refuses %o', (input, msg) => {
    const r = checkTemplate(input as Parameters<typeof checkTemplate>[0])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(msg)
  })
})

describe('the blanks for a send', () => {
  it('exactly n plain-text values; control characters flattened', () => {
    expect(checkParams(['Asha', 'A-12\n3'], 2)).toEqual({ ok: true, values: ['Asha', 'A-12 3'] })
  })
  it('wrong count, empty, objects or too long are refused', () => {
    expect(checkParams(['a'], 2).ok).toBe(false)
    expect(checkParams(['a', '  '], 2).ok).toBe(false)
    expect(checkParams(['a', { $x: 1 }], 2).ok).toBe(false)
    expect(checkParams(['a', 'b'.repeat(501)], 2).ok).toBe(false)
    expect(checkParams('a,b', 2).ok).toBe(false)
  })
  it('the Inbox shows what the customer reads', () => {
    expect(renderTemplate('Hi {{1}}, order {{2}}.', ['Asha', '123'])).toBe('Hi Asha, order 123.')
  })
})
