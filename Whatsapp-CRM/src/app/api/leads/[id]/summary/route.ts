import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse, type AccountContext } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateAiReplyWithFallback, getProviderKeys } from '@/lib/ai/providers/registry'
import { detectAndTranslate, TRANSLATE_MODEL } from '@/lib/ai/translate'
import { decrypt } from '@/lib/whatsapp/encryption'
import { recordAiUsage } from '@/lib/ai/usage'
import { audit, auditCtx } from '@/lib/audit'
import {
  buildSummaryTranscript, cleanSummary, normaliseFocus, summarySystemPrompt, summaryUserMessage,
  MIN_MESSAGES, SUMMARY_LANGUAGES,
} from '@/lib/ai/lead-summary'

/**
 * /api/leads/[id]/summary — the lead page's AI chat summary.
 *
 *   GET   ?focus=      the saved summary (if any) and how many messages came since
 *   POST  { focus }    make or refresh it (one model call)
 *   PATCH { action }   'translate' { focus, lang } — cached per language
 *                      'feedback'  { focus, vote: 'up' | 'down' }
 *                      'save_note' { text } — the person's checked text, as a lead note
 *
 * Who: anybody who can open Leads reads; agents and above make, translate
 * and save. An agent works only on a lead that is theirs or still in the
 * pool, and only their own assigned conversations go into the summary —
 * the same rule as the chat panel beside it (GET /api/contacts/[id]/timeline).
 */

const SPEAKERS = ['customer', 'agent', 'bot']
/** Each refresh is a paid call; five an hour per lead is plenty for people working it. */
const PER_LEAD = { limit: 5, windowMs: 60 * 60_000 }
const MAX_NOTE = 2000

type Ctx = AccountContext

type LeadRow = { id: string; title: string; contact_id: string | null; assigned_to: string | null }

async function loadLead(ctx: Ctx, id: string, forWork: boolean): Promise<{ error: Response } | { lead: LeadRow }> {
  const lead = await prisma.lead.findFirst({
    where: { id, account_id: ctx.accountId },
    select: { id: true, title: true, contact_id: true, assigned_to: true },
  })
  if (!lead) return { error: NextResponse.json({ error: 'Lead not found.' }, { status: 404 }) }
  if (forWork && !canViewAllLeads(ctx.role) && lead.assigned_to && lead.assigned_to !== ctx.userId) {
    return { error: NextResponse.json({ error: 'This lead belongs to somebody else.' }, { status: 403 }) }
  }
  return { lead }
}

/** The conversations this person may read for this lead's contact. */
async function conversationIds(ctx: Ctx, contactId: string | null): Promise<string[]> {
  if (!contactId) return []
  const rows = await prisma.conversation.findMany({
    where: {
      contact_id: contactId,
      account_id: ctx.accountId,
      ...(ctx.role === 'agent' ? { assigned_agent_id: ctx.userId } : {}),
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

async function newSince(convIds: string[], since: Date | null): Promise<number> {
  if (!since || convIds.length === 0) return 0
  return prisma.message.count({
    where: { conversation_id: { in: convIds }, sender_type: { in: SPEAKERS }, deleted_at: null, created_at: { gt: since } },
  })
}

function view(row: { focus: string; text_en: string; translations: unknown; created_at: Date; updated_at: Date; message_count: number; feedback: string | null } | null) {
  if (!row) return null
  const t = row.translations && typeof row.translations === 'object' ? (row.translations as Record<string, string>) : {}
  return { focus: row.focus, text: row.text_en, translations: t, madeAt: row.updated_at.toISOString(), messages: row.message_count, feedback: row.feedback }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/leads')
    const { id } = await params
    const found = await loadLead(ctx, id, false)
    if ('error' in found) return found.error
    const focus = normaliseFocus(req.nextUrl.searchParams.get('focus'))
    const row = await prisma.leadSummary.findUnique({ where: { lead_id_focus: { lead_id: id, focus } } })
    const convIds = await conversationIds(ctx, found.lead.contact_id)
    return NextResponse.json({
      summary: view(row),
      newSince: await newSince(convIds, row?.last_message_at ?? null),
      hasChat: convIds.length > 0,
      languages: SUMMARY_LANGUAGES,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireRole('agent')
    assertPageAccess(ctx, '/leads')
    const { id } = await params
    const rl = checkRateLimit(`ai-call:${ctx.userId}`, RATE_LIMITS.aiCall)
    if (!rl.success) return rateLimitResponse(rl)

    const found = await loadLead(ctx, id, true)
    if ('error' in found) return found.error
    const body = (await req.json().catch(() => ({}))) as { focus?: unknown }
    const focus = normaliseFocus(body.focus)

    const convIds = await conversationIds(ctx, found.lead.contact_id)
    const rows = convIds.length
      ? await prisma.message.findMany({
          where: { conversation_id: { in: convIds }, sender_type: { in: SPEAKERS }, deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 200,
          select: { sender_type: true, content_text: true, transcript: true, content_type: true, media_filename: true, created_at: true },
        })
      : []
    const t = buildSummaryTranscript(rows)
    if (t.used < MIN_MESSAGES) {
      return NextResponse.json({ error: 'Not enough chat to summarise yet.' }, { status: 422 })
    }

    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId } })
    if (!aiConfig) {
      return NextResponse.json({ error: 'AI is not set up. An admin can turn it on in Settings → AI.' }, { status: 400 })
    }
    // Checked after the cheap checks, so a refusal above never spends a slot.
    const perLead = checkRateLimit(`lead-summary:${id}`, PER_LEAD)
    if (!perLead.success) return rateLimitResponse(perLead)

    const started = Date.now()
    let result
    try {
      result = await generateAiReplyWithFallback(
        // Low temperature and a short ceiling: a faithful note, not a story.
        { ...aiConfig, temperature: Math.min(aiConfig.temperature, 0.2), max_tokens: Math.min(aiConfig.max_tokens || 400, 400) },
        summarySystemPrompt(focus),
        summaryUserMessage(t.text),
      )
    } catch (err) {
      console.error('[lead-summary] model call failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'The AI could not make a summary right now. Try again in a minute.' }, { status: 502 })
    }
    void recordAiUsage({
      accountId: ctx.accountId, provider: result.usedProvider, model: result.usedModel ?? 'unknown',
      feature: 'lead_summary', userId: ctx.userId, tokens: result.usage, latencyMs: Date.now() - started,
    })
    const text = cleanSummary(result.reply ?? '')
    if (!text) return NextResponse.json({ error: 'The AI gave an empty summary. Try again.' }, { status: 502 })

    // One row per lead and focus: a refresh replaces it, and its old translations go with it.
    const row = await prisma.leadSummary.upsert({
      where: { lead_id_focus: { lead_id: id, focus } },
      create: {
        account_id: ctx.accountId, lead_id: id, focus, text_en: text, translations: {},
        message_count: t.used, last_message_at: t.lastAt, model: result.usedModel ?? null, created_by: ctx.userId,
      },
      update: {
        text_en: text, translations: {}, message_count: t.used, last_message_at: t.lastAt,
        model: result.usedModel ?? null, feedback: null, created_by: ctx.userId,
      },
    })
    await audit(auditCtx(req, ctx), {
      action: 'record.updated',
      target: { type: 'lead', id, label: found.lead.title },
      meta: { op: 'ai_summary_made', focus: focus || 'all', messages: t.used },
    })
    return NextResponse.json({ summary: view(row), newSince: 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireRole('agent')
    assertPageAccess(ctx, '/leads')
    const { id } = await params
    const found = await loadLead(ctx, id, true)
    if ('error' in found) return found.error
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; focus?: unknown; lang?: unknown; vote?: unknown; text?: unknown }
    const focus = normaliseFocus(body.focus)

    if (body.action === 'save_note') {
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_NOTE) : ''
      if (!text) return NextResponse.json({ error: 'The note is empty.' }, { status: 400 })
      const note = await prisma.leadActivity.create({
        data: {
          account_id: ctx.accountId, lead_id: id, contact_id: found.lead.contact_id, user_id: ctx.userId,
          type: 'note', title: 'Chat summary (AI, checked)', description: text,
          metadata: { source: 'ai_summary', focus: focus || 'all' },
        },
        select: { id: true },
      })
      await audit(auditCtx(req, ctx), {
        action: 'record.updated',
        target: { type: 'lead', id, label: found.lead.title },
        meta: { op: 'ai_summary_saved_as_note', focus: focus || 'all' },
      })
      return NextResponse.json({ ok: true, noteId: note.id })
    }

    const row = await prisma.leadSummary.findUnique({ where: { lead_id_focus: { lead_id: id, focus } } })
    if (!row || row.account_id !== ctx.accountId) return NextResponse.json({ error: 'Make a summary first.' }, { status: 404 })

    if (body.action === 'feedback') {
      if (body.vote !== 'up' && body.vote !== 'down' && body.vote !== null) {
        return NextResponse.json({ error: 'Vote up or down.' }, { status: 400 })
      }
      const saved = await prisma.leadSummary.update({ where: { id: row.id }, data: { feedback: body.vote as string | null } })
      await audit(auditCtx(req, ctx), {
        action: 'record.updated', target: { type: 'lead', id, label: found.lead.title },
        meta: { op: 'ai_summary_feedback', vote: body.vote },
      })
      return NextResponse.json({ summary: view(saved) })
    }

    if (body.action === 'translate') {
      const lang = typeof body.lang === 'string' ? body.lang : ''
      const language = SUMMARY_LANGUAGES[lang]
      if (!language) return NextResponse.json({ error: 'Choose one of the listed languages.' }, { status: 400 })
      const cached = view(row)!.translations[lang]
      if (cached) return NextResponse.json({ summary: view(row), cached: true })

      const rl = checkRateLimit(`ai-call:${ctx.userId}`, RATE_LIMITS.aiCall)
      if (!rl.success) return rateLimitResponse(rl)
      const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId } })
      const gemini = aiConfig ? getProviderKeys(aiConfig).gemini : undefined
      if (!gemini?.api_key) {
        return NextResponse.json({ error: 'Translation needs a Gemini API key. An admin can add one in Settings → AI.' }, { status: 400 })
      }
      const started = Date.now()
      let translated: string
      try {
        const out = await detectAndTranslate({ apiKey: decrypt(gemini.api_key), text: row.text_en, targetLanguage: language })
        translated = (out.translatedText ?? '').trim()
        void recordAiUsage({
          accountId: ctx.accountId, provider: 'gemini', model: TRANSLATE_MODEL, feature: 'translation',
          userId: ctx.userId, tokens: out.usage, latencyMs: Date.now() - started,
        })
      } catch (err) {
        console.error('[lead-summary] translate failed:', err instanceof Error ? err.message : err)
        return NextResponse.json({ error: 'Could not translate right now. Try again in a minute.' }, { status: 502 })
      }
      if (!translated) return NextResponse.json({ error: 'The translation came back empty. Try again.' }, { status: 502 })
      const translations = { ...view(row)!.translations, [lang]: translated.slice(0, 2000) }
      // Only if the summary was not refreshed meanwhile: a translation of old text must not land on new text.
      const done = await prisma.leadSummary.updateMany({
        where: { id: row.id, updated_at: row.updated_at },
        data: { translations },
      })
      if (done.count === 0) return NextResponse.json({ error: 'The summary changed meanwhile. Translate again.' }, { status: 409 })
      const saved = await prisma.leadSummary.findUnique({ where: { id: row.id } })
      return NextResponse.json({ summary: view(saved), cached: false })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
