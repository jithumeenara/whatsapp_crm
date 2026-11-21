/**
 * Rewriting a customer's question so the knowledge base can find it.
 *
 * Customers here write "fees ethra aanu", "admission eppo thudangum",
 * Malayalam script, or a mix. The knowledge base is mostly English (fee
 * tables, programme lists), so neither keyword nor meaning search finds
 * "ethra" (how much) or "eppo" (when). One small model call turns the
 * message into (a) plain English, (b) Malayalam script when the customer
 * wrote Malayalam in English letters, and (c) the names, codes and numbers
 * in it — and retrieval searches with all of them.
 *
 * Only used when the first search was not confident (customer-pipeline),
 * so a clear English question costs nothing extra. Cached per text; never
 * throws (a failed rewrite simply keeps the first search).
 */
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { TRANSLATE_MODEL } from './translate'

export interface RewrittenQuery {
  english: string
  native: string
  keywords: string[]
}

const TIMEOUT_MS = 2500
const CACHE_MAX = 300
const cache = new Map<string, RewrittenQuery | null>()
export function clearQueryRewriteCache() { cache.clear() }

/** The expanded search text: the customer's words first, then the rewrites. */
export function expandedQuery(original: string, r: RewrittenQuery | null): string {
  if (!r) return original
  const parts = [original, r.english, r.native, r.keywords.join(' ')]
    .map((p) => p.trim())
    .filter((p, i, all) => p && all.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
  return parts.join(' \n ').slice(0, 800)
}

export function rewritePrompt(message: string): string {
  return [
    'A customer sent this message to a business on chat. It may be English, Malayalam, Malayalam written in English letters (Manglish), Hindi, Hinglish or a mix.',
    'Return JSON with:',
    '- english: the message as one clear English question or statement (keep names, course names, codes and numbers exactly);',
    '- native: the message in Malayalam script if it was Malayalam or Manglish, otherwise an empty string;',
    '- keywords: up to 6 important search words in English (names, products, courses, places, numbers).',
    'Do not answer the message. Do not add facts.',
    '',
    `Message: ${message.slice(0, 500)}`,
  ].join('\n')
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function parseRewrite(raw: unknown): RewrittenQuery | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const english = clean(o.english, 300)
  const native = clean(o.native, 300)
  const keywords = Array.isArray(o.keywords) ? o.keywords.map((k) => clean(k, 40)).filter(Boolean).slice(0, 6) : []
  if (!english && !native && keywords.length === 0) return null
  return { english, native, keywords }
}

export async function rewriteQuery(apiKey: string, message: string): Promise<RewrittenQuery | null> {
  const key = message.trim().toLowerCase().slice(0, 500)
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null
  let result: RewrittenQuery | null = null
  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: TRANSLATE_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            english: { type: SchemaType.STRING },
            native: { type: SchemaType.STRING },
            keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
          required: ['english', 'native', 'keywords'],
        },
      },
    })
    const call = model.generateContent(rewritePrompt(message))
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('rewrite timed out')), TIMEOUT_MS))
    const res = await Promise.race([call, timeout])
    result = parseRewrite(JSON.parse(res.response.text()))
  } catch (err) {
    console.warn('[query-rewrite] skipped:', err instanceof Error ? err.message : err)
    result = null
  }
  cache.set(key, result)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return result
}
