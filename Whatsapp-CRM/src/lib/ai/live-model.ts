/**
 * Which Live API model a voice session uses.
 *
 * The stored default was `models/gemini-2.5-flash-native-audio-preview-
 * 12-2025`. Google now limits the whole 2.5 family to accounts that used
 * it before ("Access limited to active past users", models page, October
 * 2026) and shut the 2.0 Live models down on 9 December 2025 — so a new
 * client with their own key got no live voice at all. Gemini 3.8 Live is
 * the stable successor, and takes the same setup message this app sends
 * (checked against the BidiGenerateContentSetup reference: responseModal-
 * ities and speechConfig inside generationConfig, both transcriptions at
 * the top level).
 *
 * Mapped here rather than rewritten in the database, so every server
 * picks it up on deploy without a migration, and a model somebody chose
 * deliberately (anything newer) is left exactly as it is.
 */

export const LIVE_MODEL = 'models/gemini-3.8-live'

export function currentLiveModel(stored: string | null | undefined): string {
  const id = (stored ?? '').trim()
  if (!id || /gemini-2\.[05]-/i.test(id)) return LIVE_MODEL
  return id
}
