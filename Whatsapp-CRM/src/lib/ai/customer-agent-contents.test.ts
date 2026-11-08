import { describe, expect, it } from 'vitest'
import { buildContents, describeTurns } from './customer-agent'

/**
 * Bug, seen again in production after the diagnostic line was added:
 *   generate refused (6 turns) -- user[text] > model[text] > user[text] >
 *   model[text] > model[text] > user[EMPTY-TEXT]
 *   → 400 "Requests ending with a model turn are not supported"
 * The customer's latest message had no text (a photo, sticker or voice
 * note without a caption). Gemini drops an empty text part, so the request
 * ended on the model's turn. Two model turns in a row (a reply sent in two
 * parts) are also not a valid arrangement.
 *
 * The turns must always alternate, start with the customer, and end on a
 * customer turn that has text.
 */

const roles = (c: ReturnType<typeof buildContents>) => c.map((t) => t.role).join(',')

describe('buildContents', () => {
  it('a message with no text still ends the request on a customer turn that has text', () => {
    const c = buildContents(
      [
        { role: 'user', text: 'hi' }, { role: 'model', text: 'hello' },
        { role: 'user', text: 'fees?' }, { role: 'model', text: 'It is 500.' }, { role: 'model', text: 'Anything else?' },
      ],
      '',
    )
    expect(describeTurns(c)).not.toContain('EMPTY-TEXT')
    expect(c[c.length - 1].role).toBe('user')
  })

  it('never puts two turns of the same role next to each other', () => {
    const c = buildContents(
      [{ role: 'user', text: 'hi' }, { role: 'user', text: 'are you there' }, { role: 'model', text: 'yes' }, { role: 'model', text: 'how can I help' }],
      'fees?',
    )
    expect(roles(c)).toBe('user,model,user')
  })

  it('keeps every word when it joins turns, in order', () => {
    const c = buildContents([{ role: 'model', text: 'It is 500.' }, { role: 'model', text: 'Anything else?' }], 'no')
    expect(JSON.stringify(c)).toContain('It is 500.')
    expect(JSON.stringify(c)).toContain('Anything else?')
    expect(JSON.stringify(c).indexOf('It is 500.')).toBeLessThan(JSON.stringify(c).indexOf('Anything else?'))
  })

  it('drops empty history turns and starts with the customer', () => {
    const c = buildContents([{ role: 'model', text: 'Welcome!' }, { role: 'user', text: '  ' }, { role: 'user', text: 'hi' }], 'fees?')
    // The welcome message is kept (it is context), behind a short customer turn.
    expect(roles(c)).toBe('user,model,user')
    expect(JSON.stringify(c)).toContain('Welcome!')
    expect(describeTurns(c)).not.toContain('EMPTY-TEXT')
  })

  it('an ordinary conversation is sent unchanged', () => {
    const c = buildContents([{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }], 'fees?')
    expect(c).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'fees?' }] },
    ])
  })
})
