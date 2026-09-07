/**
 * Audio transcription — deliberately NOT part of the AiProviderAdapter
 * interface in src/lib/ai/providers/ (that interface is chat-completions
 * shaped, text-in/text-out). Only two of the five configured providers
 * offer transcription at all today (confirmed against official docs,
 * Sept 2026): Gemini (gemini-3.5-transcribe) and OpenAI (gpt-transcribe).
 * Anthropic has no public audio API and DeepSeek is vision-only.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProviderKeys, ProviderKeyEntry } from './providers/registry'

export type TranscriptionProvider = 'gemini' | 'openai'

/** Picks whichever of the two transcription-capable providers the account
 *  already has a saved key for — regardless of which provider is "active"
 *  for chat replies, since an account can have a key saved-but-inactive.
 *  Gemini checked first (its transcribe model is purpose-built and cheap),
 *  OpenAI as the fallback. Returns null if neither is configured — the
 *  caller treats that as "silently skip," not an error. */
export function pickTranscriptionProvider(
  providerKeys: ProviderKeys,
): { provider: TranscriptionProvider; entry: ProviderKeyEntry } | null {
  if (providerKeys.gemini?.api_key) return { provider: 'gemini', entry: providerKeys.gemini }
  if (providerKeys.openai?.api_key) return { provider: 'openai', entry: providerKeys.openai }
  return null
}

export async function transcribeAudio(args: {
  provider: TranscriptionProvider
  apiKey: string
  audioBuffer: Buffer
  mimeType: string
}): Promise<string> {
  return args.provider === 'gemini' ? transcribeWithGemini(args) : transcribeWithOpenAI(args)
}

/** Gemini's transcribe model is invoked through the standard
 *  generateContent call (same SDK already used for chat replies), not a
 *  special endpoint — an inline base64 audio Part alongside a text
 *  instruction. */
async function transcribeWithGemini(args: { apiKey: string; audioBuffer: Buffer; mimeType: string }): Promise<string> {
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-transcribe' })
  const result = await model.generateContent([
    { inlineData: { mimeType: args.mimeType, data: args.audioBuffer.toString('base64') } },
    { text: 'Transcribe this audio accurately. Output only the transcript, nothing else.' },
  ])
  const text = result.response.text().trim()
  if (!text) throw new Error('Gemini returned an empty transcript.')
  return text
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'audio.mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'audio.m4a'
  if (mimeType.includes('wav')) return 'audio.wav'
  // WhatsApp voice notes are almost always audio/ogg; codecs=opus.
  return 'audio.ogg'
}

interface OpenAiTranscriptionErrorBody {
  error?: { message?: string }
}

/** Multipart upload to OpenAI's /v1/audio/transcriptions — confirmed
 *  shape via developers.openai.com/api/docs/guides/speech-to-text.
 *  Node's built-in FormData/Blob (Next.js 16 runtime) set the multipart
 *  boundary automatically; never set Content-Type by hand here. */
async function transcribeWithOpenAI(args: { apiKey: string; audioBuffer: Buffer; mimeType: string }): Promise<string> {
  const form = new FormData()
  const blob = new Blob([new Uint8Array(args.audioBuffer)], { type: args.mimeType })
  form.append('file', blob, filenameForMimeType(args.mimeType))
  form.append('model', 'gpt-transcribe')
  form.append('response_format', 'text')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as OpenAiTranscriptionErrorBody
    throw new Error(body.error?.message || `OpenAI transcription failed with HTTP ${res.status}`)
  }
  // response_format: 'text' returns the plain transcript as the raw body.
  const text = (await res.text()).trim()
  if (!text) throw new Error('OpenAI returned an empty transcript.')
  return text
}
