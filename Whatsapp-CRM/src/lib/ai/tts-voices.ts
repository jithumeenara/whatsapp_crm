/**
 * The prebuilt voice list, kept apart from the synthesizer itself.
 *
 * Settings is a client component, and importing this from `tts.ts` would
 * drag the MP3 encoder and Node's Buffer into the browser bundle to
 * render a five-item dropdown. The list is shared data; the synthesizer
 * is server-only.
 */
export const TTS_VOICES = [
  { id: 'Kore', label: 'Kore — neutral, clear' },
  { id: 'Puck', label: 'Puck — bright, upbeat' },
  { id: 'Charon', label: 'Charon — calm, low' },
  { id: 'Aoede', label: 'Aoede — warm' },
  { id: 'Fenrir', label: 'Fenrir — firm' },
] as const

export type TtsVoiceId = (typeof TTS_VOICES)[number]['id']
