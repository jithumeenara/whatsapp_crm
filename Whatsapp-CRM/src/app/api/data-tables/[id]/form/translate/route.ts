import { NextResponse } from 'next/server'
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit } from '@/lib/rate-limit'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'
import { loadFormForSettings, publicFormSources } from '@/lib/data-store/public-form-server'
import { formLangList, isFormLang, langInfo, type CopyEntry } from '@/lib/data-store/form-i18n'

/**
 * The public form's own text, for translating — admin only.
 *
 * GET                       every piece of the business's text a reader
 *                           sees, in the main language (as saved)
 * POST { lang, paths? }     AI translations of those (or only `paths`)
 *                           into one of the form's languages. Suggestions
 *                           only: nothing is saved until the admin saves.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL = 'gemini-3.5-flash-lite'
/** Pieces per AI call; a long lookup list is done in a few presses. */
const BATCH = 150

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.INTEGER },
          text: { type: SchemaType.STRING },
        },
        required: ['id', 'text'],
      },
    },
  },
  required: ['items'],
} as ResponseSchema

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    await ensureDataStoreColumns().catch(() => {})
    const form = await loadFormForSettings(ctx.accountId, id)
    if (!form) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json({ sources: publicFormSources(form) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as { lang?: unknown; paths?: unknown } | null
    if (!isFormLang(body?.lang)) return NextResponse.json({ error: 'Choose a language.' }, { status: 400 })
    const lang = body.lang
    const wanted = Array.isArray(body.paths)
      ? new Set(body.paths.filter((p): p is string => typeof p === 'string' && p.length <= 700).slice(0, 1000))
      : null

    await ensureDataStoreColumns().catch(() => {})
    const form = await loadFormForSettings(ctx.accountId, id)
    if (!form) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const { languages } = form.config
    if (lang === languages.main || !formLangList(languages).includes(lang)) {
      return NextResponse.json({ error: 'Add this language to the form and save first.' }, { status: 400 })
    }

    const todo = publicFormSources(form).filter((s) => !wanted || wanted.has(s.path)).slice(0, BATCH)
    if (!todo.length) return NextResponse.json({ entries: {}, more: false })

    const aiCfg = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { provider_keys: true } })
    const { apiKey } = geminiCredentials({ provider_keys: aiCfg?.provider_keys ?? null })
    if (!apiKey) return NextResponse.json({ error: 'Add a Gemini API key first (Settings → AI).' }, { status: 400 })

    // Counted only when the AI is really asked; one press may take a few calls.
    const rl = checkRateLimit(`form-translate:${ctx.accountId}`, { limit: 40, windowMs: 60 * 60_000 })
    if (!rl.success) return NextResponse.json({ error: 'Translated many times this hour. Try again later.' }, { status: 429 })

    const from = langInfo(languages.main)
    const to = langInfo(lang)
    const prompt = [
      `Translate the text of a public sign-up form from ${from.name} into ${to.name} (${to.native}).`,
      `The form belongs to: ${form.businessName ?? 'a business'}. Readers are ordinary members of the public.`,
      'Rules: natural, simple, polite words people really use; keep names of people, places, organisations,',
      'programme codes and abbreviations (like STP, PSC, KYC) as they are or transliterated; keep numbers,',
      'dates, emails, links and {{placeholders}} unchanged; translate a month or weekday name into that language;',
      'keep it about as short as the original; never add explanations. Return one item per id.',
      '',
      'TEXT (JSON):',
      JSON.stringify(todo.map((s, i) => ({ id: i, where: s.where, text: s.text }))),
    ].join('\n')

    const started = Date.now()
    let raw: unknown
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: MODEL,
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, ...(thinkingConfigFor(MODEL, 'low') ?? {}) },
      })
      const result = await model.generateContent(prompt)
      void recordAiUsage({ accountId: ctx.accountId, model: MODEL, feature: 'translation', tokens: tokensFromGemini(result.response.usageMetadata), latencyMs: Date.now() - started })
      raw = JSON.parse(result.response.text())
    } catch (err) {
      console.error('[form-translate] model failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'The AI could not translate just now. Try again in a minute.' }, { status: 502 })
    }

    // Only ids that were asked for; each keeps the text it came from, so a
    // later change to that text shows the translation needs a look.
    const entries: Record<string, CopyEntry> = {}
    const items = (raw as { items?: unknown })?.items
    for (const it of Array.isArray(items) ? items : []) {
      const i = (it as { id?: unknown }).id
      const text = (it as { text?: unknown }).text
      if (typeof i !== 'number' || !todo[i] || typeof text !== 'string') continue
      const t = text.replace(/\r\n/g, '\n').trim().slice(0, 600)
      if (t) entries[todo[i].path] = { t, s: todo[i].text }
    }
    const total = publicFormSources(form).filter((s) => !wanted || wanted.has(s.path)).length
    return NextResponse.json({ entries, more: total > todo.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
