/**
 * Asks the business's own Gemini key to explain the Performance guide's
 * facts (phase F4, opt-in: Settings → Reports). Facts only — see rules.ts —
 * and every number checked; on any failure the guide shows without it.
 * Kept for 12 hours per business and set of facts, so opening the guide
 * again costs nothing; new numbers mean new facts and a fresh answer.
 */

import { createHash } from 'node:crypto'
import { geminiGenerate, SchemaType, type ResponseSchema } from '@/lib/ai/genai'
import { prisma } from '@/lib/db'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'
import type { Finding } from '../doc/types'
import { buildPrompt, factLines, numbersIn, toFindings, type AiGuideAnswer } from './rules'

const MODEL = 'gemini-3.5-flash-lite'
const CACHE_MS = 12 * 60 * 60_000
const MAX_CACHE = 500
const cache = new Map<string, { at: number; findings: Finding[] }>()

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    actions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ['summary', 'actions'],
}

export async function aiGuideFindings(a: { accountId: string; findings: Finding[]; language: string }): Promise<Finding[]> {
  const facts = factLines(a.findings)
  if (!facts.length) return []
  const key = `${a.accountId}:${a.language}:${createHash('sha256').update(facts.join('\n')).digest('hex').slice(0, 24)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.findings

  const row = await prisma.aiConfig.findUnique({ where: { account_id: a.accountId }, select: { provider_keys: true } }).catch(() => null)
  const { apiKey } = geminiCredentials({ provider_keys: row?.provider_keys ?? null })
  if (!apiKey) return []

  const started = Date.now()
  try {
    const result = await geminiGenerate({
      apiKey,
      model: MODEL,
      contents: buildPrompt(facts, a.language),
      responseSchema: SCHEMA,
      thinking: thinkingConfigFor(MODEL, 'minimal'),
    })
    void recordAiUsage({ accountId: a.accountId, model: MODEL, feature: 'report_guide', tokens: tokensFromGemini(result.usageMetadata), latencyMs: Date.now() - started })
    let answer: AiGuideAnswer | null = null
    try { answer = JSON.parse(result.text) as AiGuideAnswer } catch { answer = null }
    const findings = toFindings(answer, new Set(numbersIn(facts.join(' '))))
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
    cache.set(key, { at: Date.now(), findings })
    return findings
  } catch (err) {
    console.error('[reports] AI guide failed (shown without it):', err instanceof Error ? err.message : err)
    return []
  }
}
