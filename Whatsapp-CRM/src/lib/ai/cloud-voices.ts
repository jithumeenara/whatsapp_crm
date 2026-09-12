/**
 * Cloud TTS voice "characters", kept apart from cloud-tts.ts so the
 * Settings screen can list them.
 *
 * cloud-tts.ts reaches for Node's crypto and the filesystem to read a
 * service account; importing it into a client component would pull both
 * into the browser bundle to render a six-item dropdown.
 *
 * The same character name exists across every language Chirp3-HD covers,
 * which is why one choice here works for an assistant that answers in
 * Malayalam, Tamil and English.
 */
export const CLOUD_VOICE_CHARACTERS = [
  { id: 'Achernar', label: 'Achernar — warm, female' },
  { id: 'Charon', label: 'Charon — calm, male' },
  { id: 'Aoede', label: 'Aoede — bright, female' },
  { id: 'Algenib', label: 'Algenib — steady, male' },
  { id: 'Despina', label: 'Despina — friendly, female' },
  { id: 'Alnilam', label: 'Alnilam — firm, male' },
] as const

export type CloudVoiceCharacter = (typeof CLOUD_VOICE_CHARACTERS)[number]['id']
