import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The doorway to the new Gemini SDK: old-style schemas and thinking levels
 * are translated, a timeout is always set, and text and usage come back in
 * the shapes the rest of the app reads.
 */

const h = vi.hoisted(() => ({ ctor: null as unknown, req: null as unknown }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (req: unknown) => {
        h.req = req
        return { text: '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, cachedContentTokenCount: 4 } }
      },
    }
    constructor(opts: unknown) { h.ctor = opts }
  },
}))

import { geminiGenerate, normaliseSchema, normaliseThinking } from './genai'

beforeEach(() => { h.ctor = null; h.req = null })

describe('normalising old-SDK shapes', () => {
  it('schema types are upper-cased all the way down, property names untouched', () => {
    const s = { type: 'object', properties: { type: { type: 'string' }, list: { type: 'array', items: { type: 'integer' } } }, required: ['type'] }
    expect(normaliseSchema(s)).toEqual({ type: 'OBJECT', properties: { type: { type: 'STRING' }, list: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['type'] })
  })
  it('thinking level becomes the enum the new SDK expects', () => {
    expect(normaliseThinking({ thinkingConfig: { thinkingLevel: 'minimal' } })).toEqual({ thinkingLevel: 'MINIMAL' })
    expect(normaliseThinking(undefined)).toBeUndefined()
  })
})

describe('geminiGenerate', () => {
  it('sends model, prompt and config, always with a timeout; returns text and usage', async () => {
    const r = await geminiGenerate({
      apiKey: 'k', model: 'gemini-3.5-flash-lite', contents: 'hi', systemInstruction: 'be brief',
      responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      thinking: { thinkingConfig: { thinkingLevel: 'minimal' } },
    })
    expect(h.ctor).toEqual({ apiKey: 'k', httpOptions: { timeout: 60_000 } })
    expect(h.req).toEqual({
      model: 'gemini-3.5-flash-lite',
      contents: 'hi',
      config: {
        systemInstruction: 'be brief',
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } },
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
    })
    expect(r).toEqual({ text: '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, cachedContentTokenCount: 4 } })
  })
})
