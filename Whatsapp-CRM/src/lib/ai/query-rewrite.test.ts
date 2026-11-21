import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: 0, reply: '' as string, fail: false }))
vi.mock('@google/generative-ai', () => ({
  SchemaType: { OBJECT: 'object', STRING: 'string', ARRAY: 'array' },
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => {
          h.calls++
          if (h.fail) throw new Error('quota')
          return { response: { text: () => h.reply } }
        },
      }
    }
  },
}))

import { clearQueryRewriteCache, expandedQuery, parseRewrite, rewritePrompt, rewriteQuery } from './query-rewrite'

beforeEach(() => {
  h.calls = 0; h.fail = false
  h.reply = JSON.stringify({ english: 'What is the fee?', native: 'ഫീസ് എത്രയാണ്?', keywords: ['fee', 'MDP'] })
  clearQueryRewriteCache()
})

describe('rewriteQuery', () => {
  it('turns a Manglish question into English, Malayalam script and keywords', async () => {
    const r = await rewriteQuery('k', 'MDP fees ethra aanu')
    expect(r).toEqual({ english: 'What is the fee?', native: 'ഫീസ് എത്രയാണ്?', keywords: ['fee', 'MDP'] })
  })

  it('asks once per text (cached), whatever the case', async () => {
    await rewriteQuery('k', 'MDP fees ethra aanu')
    await rewriteQuery('k', 'mdp FEES ethra aanu')
    expect(h.calls).toBe(1)
  })

  it('a failed call keeps the first search (null), and does not throw', async () => {
    h.fail = true
    expect(await rewriteQuery('k', 'eppo thudangum')).toBeNull()
  })

  it('never answers the message or adds facts', () => {
    expect(rewritePrompt('x')).toMatch(/Do not answer the message\. Do not add facts\./)
  })
})

describe('expandedQuery and parseRewrite', () => {
  it('keeps the customer’s words first and drops repeats', () => {
    expect(expandedQuery('fees ethra', { english: 'fees ethra', native: 'ഫീസ് എത്ര', keywords: ['fee'] }))
      .toBe('fees ethra \n ഫീസ് എത്ര \n fee')
  })

  it('no rewrite: the original query unchanged', () => {
    expect(expandedQuery('hello', null)).toBe('hello')
  })

  it('rejects empty or malformed model output', () => {
    expect(parseRewrite(null)).toBeNull()
    expect(parseRewrite({ english: '', native: '', keywords: [] })).toBeNull()
    expect(parseRewrite({ english: 'x', keywords: ['a', 2, 'b'] })).toEqual({ english: 'x', native: '', keywords: ['a', 'b'] })
  })
})
