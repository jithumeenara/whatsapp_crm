/**
 * The WebSocket endpoint the live-voice console connects to.
 *
 * Attached to the HTTP server in server.ts rather than being a route
 * handler, because Next.js route handlers cannot accept a WebSocket
 * upgrade.
 *
 * Every session is authorised by a signed ticket issued from an ordinary
 * authenticated route (see live-voice-ticket.ts), so this layer never
 * parses a session cookie and never takes an account id from the client.
 * The account's API key stays on this side throughout.
 */

import type { Server as HttpServer, IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyLiveVoiceTicket } from './live-voice-ticket'
import { openLiveVoiceSession, type LiveVoiceSession } from './live-voice'

export const LIVE_VOICE_PATH = '/api/ai/live-voice'

/** One live session per socket, and a ceiling on concurrent sessions:
 *  each one holds an upstream connection billing for audio in both
 *  directions, and a runaway client should not be able to open fifty. */
const MAX_CONCURRENT_SESSIONS = 8
let activeSessions = 0

/**
 * Everything the relay needs, resolved on this side from the account id
 * in the ticket. Passed in as a function so this module does not import
 * Prisma or the prompt builder directly — server.ts loads it at boot,
 * and pulling the whole data layer into that path slows every start.
 */
export type LiveVoiceContextLoader = (args: {
  accountId: string
  mode: 'customer' | 'admin'
}) => Promise<{
  apiKey: string
  model: string
  voiceName: string
  systemInstruction: string
} | null>

export function attachLiveVoiceServer(
  httpServer: HttpServer,
  loadContext: LiveVoiceContextLoader,
): void {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname
    } catch {
      return
    }
    // Anything else — socket.io's own upgrade in particular — must be
    // left alone rather than rejected here.
    if (pathname !== LIVE_VOICE_PATH) return

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, req, loadContext)
    })
  })
}

async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  loadContext: LiveVoiceContextLoader,
): Promise<void> {
  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
  }
  const fail = (message: string) => {
    send({ type: 'error', message })
    ws.close()
  }

  const ticketValue = new URL(req.url ?? '', 'http://localhost').searchParams.get('ticket')
  const ticket = ticketValue ? verifyLiveVoiceTicket(ticketValue) : null
  if (!ticket) {
    fail('This voice session could not be authorised. Reload the page and try again.')
    return
  }

  if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
    fail('Too many voice sessions are open right now. Close one and try again.')
    return
  }

  let context: Awaited<ReturnType<LiveVoiceContextLoader>>
  try {
    context = await loadContext({ accountId: ticket.accountId, mode: ticket.mode })
  } catch (err) {
    fail(err instanceof Error ? err.message : 'The voice session could not be started.')
    return
  }
  if (!context) {
    fail('Live voice is turned off, or no Gemini key is configured for this account.')
    return
  }

  activeSessions++
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeSessions--
  }

  let session: LiveVoiceSession | null = null

  session = openLiveVoiceSession({
    apiKey: context.apiKey,
    model: context.model,
    voiceName: context.voiceName,
    systemInstruction: context.systemInstruction,
    events: {
      onReady: () => send({ type: 'ready' }),
      // Audio goes as its own binary frame rather than base64 inside
      // JSON: a 24 kHz stream base64-encoded is a third larger and has
      // to be decoded in the browser's audio path, where the work shows
      // up as stutter.
      onAudio: (pcm) => {
        if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true })
      },
      onText: (text) => send({ type: 'text', text }),
      onInputTranscript: (text) => send({ type: 'input_transcript', text }),
      onOutputTranscript: (text) => send({ type: 'output_transcript', text }),
      onInterrupted: () => send({ type: 'interrupted' }),
      onTurnComplete: () => send({ type: 'turn_complete' }),
      onError: (message) => send({ type: 'error', message }),
      onClose: (reason) => {
        send({ type: 'closed', reason })
        release()
        if (ws.readyState === ws.OPEN) ws.close()
      },
    },
  })

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!session) return
    // Binary frames are microphone audio; everything else is control.
    if (isBinary) {
      session.sendAudio(data)
      return
    }
    try {
      const msg = JSON.parse(data.toString()) as { type?: string; text?: string }
      if (msg.type === 'text' && msg.text) session.sendText(msg.text)
      if (msg.type === 'close') session.close()
    } catch {
      /* a malformed control frame is ignored rather than killing the call */
    }
  })

  ws.on('close', () => {
    session?.close()
    release()
  })

  ws.on('error', () => {
    session?.close()
    release()
  })
}
