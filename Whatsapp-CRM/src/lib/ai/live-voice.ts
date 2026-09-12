/**
 * Real-time spoken conversation with the assistant, over the Gemini Live
 * API.
 *
 * The browser streams microphone audio to this server; this server holds
 * the upstream WebSocket to Gemini and relays audio back. The relay is
 * not indirection for its own sake: the account's API key would
 * otherwise have to reach the browser, where anyone can read it out of
 * the network tab. It also means the session is built from the same
 * company profile, knowledge base and prompt as a real reply, so what
 * you hear is what a customer would hear rather than a generic model.
 *
 * What this is and is not:
 *
 *   - It **is** a way to hear whether the assistant sounds like a person
 *     and answers correctly when spoken to, before letting it near
 *     customers.
 *   - It is **not** a phone line for customers. WhatsApp's Cloud API has
 *     no real-time audio channel: voice notes are files sent after the
 *     fact. Carrying a live conversation to a customer would need the
 *     separate WhatsApp Business Calling product and Meta's approval.
 *     The voice-note path (see speech.ts) is what customers actually get.
 *
 * Audio formats are fixed by the API, not chosen here: 16 kHz signed
 * 16-bit PCM in, 24 kHz signed 16-bit PCM out, both mono.
 */

import WebSocket from 'ws'

const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export const LIVE_INPUT_SAMPLE_RATE = 16_000
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000

/** A session left open costs money for as long as it is open, and a
 *  browser tab that crashes never sends a close frame. */
const MAX_SESSION_MS = 10 * 60_000
/** No audio and no messages for this long means the tab is gone. */
const IDLE_TIMEOUT_MS = 90_000

export interface LiveVoiceEvents {
  /** Raw PCM for the browser to play. */
  onAudio: (pcm: Buffer) => void
  /** The model's own words, when it sends them alongside the audio. */
  onText: (text: string) => void
  /** What the customer said, as the API transcribed it. */
  onInputTranscript: (text: string) => void
  /** The model's audio, transcribed — so the session can be read as well
   *  as heard, and kept as a record. */
  onOutputTranscript: (text: string) => void
  /** The model stopped because the person started talking. The browser
   *  must drop any audio it has buffered, or the two overlap. */
  onInterrupted: () => void
  onTurnComplete: () => void
  onReady: () => void
  onError: (message: string) => void
  onClose: (reason: string) => void
}

export interface LiveVoiceSession {
  /** 16 kHz mono PCM16 from the microphone. */
  sendAudio: (pcm: Buffer) => void
  /** Typed input, so the console is usable without a microphone. */
  sendText: (text: string) => void
  close: () => void
  readonly ready: boolean
}

export function openLiveVoiceSession(args: {
  apiKey: string
  model: string
  voiceName: string
  systemInstruction: string
  events: LiveVoiceEvents
}): LiveVoiceSession {
  const upstream = new WebSocket(`${LIVE_ENDPOINT}?key=${encodeURIComponent(args.apiKey)}`)

  let ready = false
  let closed = false
  /** Audio recorded before setup completes would be rejected; a small
   *  queue means the first half-second of speech is not lost. */
  const pending: Buffer[] = []

  let idleTimer: NodeJS.Timeout | null = null
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => shutdown('idle'), IDLE_TIMEOUT_MS)
  }
  const maxTimer = setTimeout(() => shutdown('session limit reached'), MAX_SESSION_MS)

  function shutdown(reason: string) {
    if (closed) return
    closed = true
    if (idleTimer) clearTimeout(idleTimer)
    clearTimeout(maxTimer)
    try {
      upstream.close()
    } catch {
      /* already gone */
    }
    args.events.onClose(reason)
  }

  upstream.on('open', () => {
    upstream.send(
      JSON.stringify({
        setup: {
          model: args.model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: args.voiceName } },
            },
          },
          systemInstruction: { parts: [{ text: args.systemInstruction }] },
          // Both transcriptions on: without them the session is audio
          // only, so nothing can be read back, logged, or checked against
          // what the assistant was supposed to say.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }),
    )
    touch()
  })

  upstream.on('message', (raw) => {
    touch()
    let msg: LiveServerMessage
    try {
      msg = JSON.parse(raw.toString()) as LiveServerMessage
    } catch {
      return
    }

    if (msg.setupComplete) {
      ready = true
      args.events.onReady()
      for (const chunk of pending.splice(0)) sendAudioNow(chunk)
      return
    }

    if (msg.serverContent?.interrupted) {
      // The person talked over the assistant. Everything already sent to
      // the browser is now stale and must be dropped, or the interrupted
      // sentence keeps playing underneath the new answer.
      args.events.onInterrupted()
    }

    const inputText = msg.serverContent?.inputTranscription?.text
    if (inputText) args.events.onInputTranscript(inputText)

    const outputText = msg.serverContent?.outputTranscription?.text
    if (outputText) args.events.onOutputTranscript(outputText)

    for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        args.events.onAudio(Buffer.from(part.inlineData.data, 'base64'))
      }
      // Native-audio models emit their reasoning as text parts. Passing
      // it through would show the customer-facing console a stream of
      // "**Choosing the simplest greeting**..." — seen in live testing.
      // Only the spoken words, via outputTranscription above, are shown.
      if (part.text && !part.thought) args.events.onText(part.text)
    }

    if (msg.serverContent?.turnComplete) args.events.onTurnComplete()

    if (msg.goAway) shutdown('the server asked to end the session')
  })

  upstream.on('error', (err: Error) => {
    args.events.onError(err.message)
    shutdown(`error: ${err.message}`)
  })

  upstream.on('close', (code: number, reason: Buffer) => {
    shutdown(`upstream closed (${code}) ${reason.toString().slice(0, 120)}`)
  })

  function sendAudioNow(pcm: Buffer) {
    if (upstream.readyState !== WebSocket.OPEN) return
    upstream.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: `audio/pcm;rate=${LIVE_INPUT_SAMPLE_RATE}`,
            data: pcm.toString('base64'),
          },
        },
      }),
    )
  }

  return {
    get ready() {
      return ready
    },
    sendAudio(pcm) {
      if (closed) return
      touch()
      if (!ready) {
        // Bounded: if setup never completes, this must not grow forever.
        if (pending.length < 40) pending.push(pcm)
        return
      }
      sendAudioNow(pcm)
    },
    sendText(text) {
      if (closed || upstream.readyState !== WebSocket.OPEN) return
      touch()
      upstream.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }),
      )
    },
    close() {
      shutdown('closed by the browser')
    },
  }
}

/** Only the fields this relay reads. The Live API sends a good deal
 *  more; typing all of it would be a maintenance cost for no benefit. */
interface LiveServerMessage {
  setupComplete?: unknown
  goAway?: unknown
  serverContent?: {
    interrupted?: boolean
    turnComplete?: boolean
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    modelTurn?: {
      parts?: { text?: string; thought?: boolean; inlineData?: { data?: string; mimeType?: string } }[]
    }
  }
}
