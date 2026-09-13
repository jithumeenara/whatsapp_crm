/**
 * Chat message translation — detects the language of a piece of text and
 * translates it to a target language in one Gemini call. Powers the
 * inbox's "Translate" link on inbound customer messages and the
 * composer's "Translate" button on an outbound draft.
 *
 * Gemini-only, same reasoning as embeddings.ts: this app's real customer
 * base needs strong Indic-language quality (Malayalam especially), which
 * ruled out DeepL entirely during research — DeepL added Tamil/Marathi
 * only in Nov 2025 and still doesn't support Malayalam at all as of this
 * writing. Reuses the account's own stored Gemini key, same BYO-key model
 * as chat replies and embeddings — nothing new to configure.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

/** Cheap, fast, and translation doesn't need the account's own configured
 *  chat model (which might be tuned/prompted for something else entirely)
 *  — a fixed, known-good model keeps this feature's behavior predictable
 *  regardless of what the account has set as active_provider elsewhere. */
export const TRANSLATE_MODEL = 'gemini-3.5-flash-lite'

export interface TranslateResult {
  /** The translation written in English letters, when asked for.
   *
   *  For an agent who speaks a language but does not read its script —
   *  common with Malayalam here — a perfect native-script translation is
   *  unreadable, and therefore uncheckable before sending. */
  romanized?: string
  /** Best-effort language name Gemini detected the source text as being
   *  written in, e.g. "Arabic", "Tamil". Free text, not an ISO code — kept
   *  human-readable since it's shown directly in the UI ("Translated from
   *  Arabic"). */
  detectedLanguage: string
  translatedText: string
  /** Gemini-reported token counts for this call, so the caller (which
   *  has the account context this module deliberately doesn't) can
   *  record it in the Usage tab. */
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}

/** True when the detected source language is already close enough to the
 *  target that translating would be pointless — a simple case-insensitive
 *  match on the language name (both sides are free text from the same
 *  vocabulary Gemini uses, so this is reliable enough without a full
 *  language-code normalization layer). */
export function isAlreadyTargetLanguage(detectedLanguage: string, targetLanguage: string): boolean {
  return detectedLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
}

export async function detectAndTranslate(args: {
  apiKey: string
  text: string
  targetLanguage: string
  /** Also return the translation in English letters. Asked for in the
   *  same call: the model already holds the sentence, and
   *  transliterating its own output is cheaper and more faithful than
   *  sending the result back through a second pass. */
  includeRomanized?: boolean
}): Promise<TranslateResult> {
  const { apiKey, text, targetLanguage, includeRomanized } = args
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: TRANSLATE_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          detected_language: { type: SchemaType.STRING, description: 'The language the input text is written in, as a plain English name (e.g. "Arabic", "Tamil", "English").' },
          translated_text: { type: SchemaType.STRING, description: `The input text translated into ${targetLanguage}.` },
          ...(includeRomanized
            ? {
                romanized_text: {
                  type: SchemaType.STRING,
                  description: `The same ${targetLanguage} translation written using English letters, spelled the way it sounds.`,
                },
              }
            : {}),
        },
        required: includeRomanized
          ? ['detected_language', 'translated_text', 'romanized_text']
          : ['detected_language', 'translated_text'],
      },
    },
  })

  const romanizedInstruction = includeRomanized
    ? `\n\nAlso provide romanized_text: exactly the same ${targetLanguage} translation, written in English letters the way it is pronounced. Do not translate it into English — a Malayalam sentence becomes "ningalude admission labhichu", not "your admission is received". Keep names, numbers and English loanwords spelled as they normally are.`
    : ''

  const prompt = `Detect the language of the following text, then translate it into ${targetLanguage}. Preserve the original tone and meaning — this is a customer support chat message, not a formal document. If the text is already in ${targetLanguage}, still report the detected language accurately and return the text unchanged as the translation.${romanizedInstruction}\n\nText:\n${text}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text()

  let parsed: { detected_language?: string; translated_text?: string; romanized_text?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Translation model returned malformed output.')
  }
  if (!parsed.detected_language || !parsed.translated_text) {
    throw new Error('Translation model response missing required fields.')
  }

  const usage = result.response.usageMetadata
  return {
    detectedLanguage: parsed.detected_language,
    translatedText: parsed.translated_text,
    ...(parsed.romanized_text ? { romanized: parsed.romanized_text } : {}),
    // Returned rather than recorded here: this module is a pure
    // Gemini wrapper with no account context, and the route that calls
    // it already has one. Keeps the usage write where the session is.
    ...(usage
      ? {
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          },
        }
      : {}),
  }
}
