/**
 * One small doorway to Gemini through Google's current SDK, @google/genai.
 *
 * The old @google/generative-ai SDK is deprecated. Call sites move here in
 * stages (admin features first, the customer reply path last), so each
 * stage can be checked live before the next. This file speaks the shapes
 * the old call sites already use — a schema written with the old
 * SchemaType values, a thinking level from reasoning.ts — and translates:
 *
 *   - schema `type` values: old SDK lowercase ("object") → "OBJECT";
 *   - thinkingConfig.thinkingLevel: "minimal" → "MINIMAL";
 *   - a timeout is always set (the SDK's own, plus our outbound deadline,
 *     since the SDK uses fetch);
 *   - usage comes back in the old `usageMetadata` shape for pricing.ts.
 *
 * The API key is passed per call and never logged.
 */

import { GoogleGenAI } from '@google/genai'
import type { GeminiUsageMetadata } from './pricing'

const DEFAULT_TIMEOUT_MS = 60_000

/** Schema type names, so moved call sites keep writing `SchemaType.STRING`
 *  without importing the old SDK. Values are what the API expects. */
export const SchemaType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
} as const

/** A JSON reply schema (OpenAPI subset), as call sites write it. */
export type ResponseSchema = {
  type: string
  description?: string
  enum?: string[]
  items?: ResponseSchema
  properties?: Record<string, ResponseSchema>
  required?: string[]
  nullable?: boolean
  format?: string
  maxItems?: number
  minItems?: number
}

/** A schema with its `type` values upper-cased, recursively (no mutation). */
export function normaliseSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => normaliseSchema(s)) as unknown as T
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase()
    else if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, normaliseSchema(pv)]))
    } else if (v && typeof v === 'object') out[k] = normaliseSchema(v)
    else out[k] = v
  }
  return out as T
}

/** reasoning.ts's { thinkingConfig: { thinkingLevel: 'minimal' } } in the new SDK's form. */
export function normaliseThinking(t: { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } } | undefined | null) {
  const c = t?.thinkingConfig
  if (!c) return undefined
  return {
    ...(c.thinkingLevel ? { thinkingLevel: c.thinkingLevel.toUpperCase() } : {}),
    ...(typeof c.thinkingBudget === 'number' ? { thinkingBudget: c.thinkingBudget } : {}),
  } as Record<string, unknown>
}

export interface GenerateArgs {
  apiKey: string
  model: string
  /** A plain prompt, or the old SDK's array of parts / contents. */
  contents: unknown
  systemInstruction?: string
  /** JSON reply: give a schema (old SchemaType values are fine). */
  responseSchema?: unknown
  responseMimeType?: string
  thinking?: { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } } | null
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

export interface GenerateResult {
  text: string
  usageMetadata: GeminiUsageMetadata | undefined
}

export async function geminiGenerate(args: GenerateArgs): Promise<GenerateResult> {
  const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ai = new GoogleGenAI({ apiKey: args.apiKey, httpOptions: { timeout } })
  const thinkingConfig = normaliseThinking(args.thinking)
  const config: Record<string, unknown> = {
    ...(args.systemInstruction ? { systemInstruction: args.systemInstruction } : {}),
    ...(args.responseSchema ? { responseMimeType: args.responseMimeType ?? 'application/json', responseSchema: normaliseSchema(args.responseSchema) } : {}),
    ...(!args.responseSchema && args.responseMimeType ? { responseMimeType: args.responseMimeType } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
    ...(typeof args.temperature === 'number' ? { temperature: args.temperature } : {}),
    ...(typeof args.maxOutputTokens === 'number' ? { maxOutputTokens: args.maxOutputTokens } : {}),
  }
  const res = await ai.models.generateContent({
    model: args.model,
    contents: args.contents as never,
    config: config as never,
  })
  return { text: res.text ?? '', usageMetadata: res.usageMetadata as GeminiUsageMetadata | undefined }
}
