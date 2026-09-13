import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { decrypt } from '@/lib/whatsapp/encryption'
import { detectAndTranslate, isAlreadyTargetLanguage, TRANSLATE_MODEL } from '@/lib/ai/translate'
import { recordAiUsage } from '@/lib/ai/usage'

/**
 * POST /api/messages/translate
 * Body: { message_id?: string, text?: string, target_language: string }
 *
 * Two shapes, one endpoint:
 *   - message_id set: translates a real inbound message — result is
 *     cached on the Message row (detected_lang/translated_text/
 *     translated_lang) so reopening the conversation doesn't re-call
 *     Gemini, and Contact.detected_language is updated so the composer's
 *     "translate my reply" button knows what language to translate into
 *     without asking Gemini to re-detect it.
 *   - text set (no message_id): an ad-hoc translation of an outbound
 *     draft that was never persisted — no caching, nothing to cache.
 *
 * 'agent' floor — this is part of actively working a conversation (same
 * floor as sending a message), and it spends the account's own Gemini
 * quota on every call.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent')

    const body = await req.json().catch(() => ({}))
    const { message_id, text, target_language, romanized } = body as {
      message_id?: string
      text?: string
      target_language?: string
      /** Also return the translation in English letters, for an agent
       *  who speaks the language but does not read its script. */
      romanized?: boolean
    }

    if (!target_language || typeof target_language !== 'string' || !target_language.trim()) {
      return NextResponse.json({ error: 'target_language is required' }, { status: 400 })
    }
    const targetLanguage = target_language.trim()

    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId } })
    const geminiEntry = aiConfig ? getProviderKeys(aiConfig).gemini : undefined
    if (!geminiEntry?.api_key) {
      return NextResponse.json(
        { error: 'Translation needs a Gemini API key — add one in Settings > AI Config.' },
        { status: 400 },
      )
    }
    const geminiApiKey = decrypt(geminiEntry.api_key)

    if (message_id) {
      const message = await prisma.message.findFirst({
        where: { id: message_id, conversation: { account_id: ctx.accountId } },
        select: {
          id: true,
          content_text: true,
          conversation_id: true,
          translated_text: true,
          translated_lang: true,
          detected_lang: true,
          conversation: { select: { contact_id: true } },
        },
      })
      if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      if (!message.content_text?.trim()) {
        return NextResponse.json({ error: 'Nothing to translate — this message has no text.' }, { status: 400 })
      }

      // Cache hit — already translated into this exact target language.
      // A cached row only ever holds the native-script translation, so a
      // request that wants English letters has to go to the model even
      // when a translation already exists.
      if (message.translated_text && message.translated_lang === targetLanguage && romanized !== true) {
        return NextResponse.json({
          detected_language: message.detected_lang,
          translated_text: message.translated_text,
          already_target_language: message.detected_lang ? isAlreadyTargetLanguage(message.detected_lang, targetLanguage) : false,
          cached: true,
        })
      }

      let result
      try {
        result = await detectAndTranslate({ apiKey: geminiApiKey, text: message.content_text, targetLanguage, includeRomanized: romanized === true })
        void recordAiUsage({
          accountId: ctx.accountId,
          model: TRANSLATE_MODEL,
          feature: 'translation',
          tokens: result.usage,
        })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Translation failed' },
          { status: 502 },
        )
      }

      await prisma.message.update({
        where: { id: message.id },
        data: {
          detected_lang: result.detectedLanguage,
          translated_text: result.translatedText,
          translated_lang: targetLanguage,
        },
      })
      if (message.conversation.contact_id) {
        await prisma.contact.update({
          where: { id: message.conversation.contact_id },
          data: { detected_language: result.detectedLanguage },
        }).catch(() => {}) // best-effort — never fails the translation itself
      }

      return NextResponse.json({
        detected_language: result.detectedLanguage,
        translated_text: result.translatedText,
        romanized_text: result.romanized ?? null,
        already_target_language: isAlreadyTargetLanguage(result.detectedLanguage, targetLanguage),
        cached: false,
      })
    }

    if (text && text.trim()) {
      let result
      try {
        result = await detectAndTranslate({ apiKey: geminiApiKey, text: text.trim(), targetLanguage, includeRomanized: romanized === true })
        void recordAiUsage({
          accountId: ctx.accountId,
          model: TRANSLATE_MODEL,
          feature: 'translation',
          tokens: result.usage,
        })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Translation failed' },
          { status: 502 },
        )
      }
      return NextResponse.json({
        detected_language: result.detectedLanguage,
        translated_text: result.translatedText,
        romanized_text: result.romanized ?? null,
        already_target_language: isAlreadyTargetLanguage(result.detectedLanguage, targetLanguage),
        cached: false,
      })
    }

    return NextResponse.json({ error: 'message_id or text is required' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
