/**
 * Reply-language intelligence.
 *
 * Replaces the "Reply language" dropdown that used to be set during
 * setup. That setting was a guess made before a single customer had
 * written in, and it then overrode their actual language on every
 * message afterwards — somebody writing in Malayalam got answered in
 * English because of a dropdown touched once, months earlier.
 *
 * Language is decided per message instead, from two things:
 *
 *   1. A deterministic script signal (below). Unicode ranges are not a
 *      guess — if the text contains Malayalam codepoints, it is
 *      Malayalam, and no model needs to be asked.
 *   2. An instruction that hands the model the remaining judgement:
 *      which language romanized text is in, which language to use when a
 *      thread mixes two, and what to do when the customer switches.
 *
 * The split matters. Script is cheap and certain, so it is computed.
 * Romanization and code-switching are genuinely ambiguous, so they are
 * described to the model rather than decided by a regex that would be
 * wrong a quarter of the time.
 */

/** Scripts worth telling the model about, in the order they are tested.
 *  Each entry's range is the script's main Unicode block. */
const SCRIPTS: { name: string; language: string; test: RegExp }[] = [
  { name: 'Malayalam', language: 'Malayalam', test: /[ഀ-ൿ]/ },
  { name: 'Tamil', language: 'Tamil', test: /[஀-௿]/ },
  { name: 'Devanagari', language: 'Hindi or Marathi', test: /[ऀ-ॿ]/ },
  { name: 'Kannada', language: 'Kannada', test: /[ಀ-೿]/ },
  { name: 'Telugu', language: 'Telugu', test: /[ఀ-౿]/ },
  { name: 'Arabic', language: 'Arabic', test: /[؀-ۿ]/ },
  { name: 'Bengali', language: 'Bengali', test: /[ঀ-৿]/ },
  { name: 'Gurmukhi', language: 'Punjabi', test: /[਀-੿]/ },
  { name: 'Gujarati', language: 'Gujarati', test: /[઀-૿]/ },
  { name: 'Sinhala', language: 'Sinhala', test: /[඀-෿]/ },
]

/**
 * Words that are overwhelmingly Malayalam when written in Latin letters.
 *
 * Deliberately a short list of high-signal function words rather than a
 * dictionary: these are the words that appear in almost any Manglish
 * sentence and almost never in English. "enthu", "undo", "cheyyam".
 *
 * This is a hint, not a verdict — it raises "probably Manglish" for the
 * model to confirm, because a false positive here would have the bot
 * replying in romanized Malayalam to an English speaker.
 */
const MANGLISH_MARKERS = [
  'enthu', 'entha', 'ente', 'njan', 'ningal', 'ningade', 'avide', 'evide',
  'undo', 'illa', 'venam', 'vendam', 'cheyyam', 'cheyyan', 'ariyamo',
  'parayu', 'parayamo', 'ethra', 'eppol', 'eppo', 'aanu', 'aano', 'alle',
  'sheriyaano', 'kittumo', 'kittum', 'thanks', 'chetta', 'chechi',
]

export type LanguageSignal = {
  /** Script detected from Unicode ranges, when the text has one. */
  script: string | null
  /** The language that script implies, when unambiguous. */
  scriptLanguage: string | null
  /** Latin-script text carrying several Malayalam function words. */
  looksRomanizedMalayalam: boolean
  /** One line for the prompt, or null when there is nothing certain to say. */
  hint: string | null
}

/**
 * Reads what can be known for certain from the customer's own text.
 *
 * Returns nulls rather than guesses when the text is too short or too
 * plain to tell — an empty hint leaves the model to its own judgement,
 * which is the correct outcome for "ok" or "👍".
 */
export function detectLanguageSignal(text: string): LanguageSignal {
  const trimmed = (text || '').trim()

  const script = SCRIPTS.find((s) => s.test.test(trimmed)) ?? null
  if (script) {
    return {
      script: script.name,
      scriptLanguage: script.language,
      looksRomanizedMalayalam: false,
      hint: `The customer wrote in ${script.name} script. Reply in ${script.language}, using the same ${script.name} script — do not romanize it and do not switch to English.`,
    }
  }

  // Two markers, not one: "thanks" alone is English, and a single
  // coincidental match ("undo") should not flip an English thread.
  const words = trimmed.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  const hits = words.filter((w) => MANGLISH_MARKERS.includes(w))
  const looksRomanizedMalayalam = new Set(hits).size >= 2

  if (looksRomanizedMalayalam) {
    return {
      script: 'Latin',
      scriptLanguage: null,
      looksRomanizedMalayalam: true,
      hint: 'The customer appears to be writing Malayalam in English letters (Manglish). Reply the same way — Malayalam words spelled in English letters, not Malayalam script, and not translated into English.',
    }
  }

  return { script: null, scriptLanguage: null, looksRomanizedMalayalam: false, hint: null }
}

/**
 * The standing instruction, appended to every customer prompt.
 *
 * Covers the parts a script check cannot: mid-thread switches, threads
 * that mix two languages in one sentence, and the rule that proper nouns
 * stay as they are. Written as rules the model applies to the message in
 * front of it rather than a language named up front, which is the whole
 * point of removing the setting.
 */
export const LANGUAGE_INSTRUCTION = [
  'LANGUAGE:',
  "- Reply in the same language the customer used in their most recent message. Do not pick a language in advance, and do not default to English.",
  '- Match their script as well as their language. If they write Malayalam in English letters, reply in Malayalam in English letters.',
  '- If they switch language mid-conversation, switch with them. The latest message decides, not the first one.',
  '- If one message mixes two languages, reply in the language that carries most of the meaning, and keep the mixed words they used.',
  '- Keep names, course titles, place names and amounts exactly as they are normally written. Do not translate a proper noun.',
  "- If you genuinely cannot tell, reply in English and keep it simple.",
].join('\n')

/**
 * Builds the language section for one specific message: the standing
 * rules, plus whatever the script check established for certain.
 */
export function buildLanguageBlock(customerMessage: string): string {
  const { hint } = detectLanguageSignal(customerMessage)
  return hint ? `${LANGUAGE_INSTRUCTION}\n- ${hint}` : LANGUAGE_INSTRUCTION
}
