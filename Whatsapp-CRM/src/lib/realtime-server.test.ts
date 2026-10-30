import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as SocketIOServer } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { issueRealtimeTicket } from './realtime-ticket'
import { attachAccountNamespace, disconnectUserSockets, socketCorsOrigin } from './realtime-server'
import { reconnectWhenServerCloses } from './realtime-client'

/**
 * The staff socket is admitted once, by ticket. What these tests are
 * about is afterwards: a connection must not outlive the session that
 * opened it by more than a bounded time, and a removed member's open
 * tab must be cut off rather than keep receiving the account's messages.
 */

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'realtime-server-test'
})

// Real sockets: generous limits so a busy machine running the whole
// suite in parallel is slow, not red. Nothing below waits on a fixed
// sleep — each step waits for the event that proves it happened.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })

let http: HttpServer
let io: SocketIOServer
const clients: Socket[] = []

async function start(maxLifetimeMs?: number) {
  http = createServer()
  io = new SocketIOServer(http)
  ;(global as unknown as { io?: SocketIOServer }).io = io
  attachAccountNamespace(io, maxLifetimeMs ? { maxLifetimeMs } : {})
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  return (http.address() as AddressInfo).port
}

function client(port: number, ticket: () => string, reconnection = false) {
  const s = connect(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection,
    reconnectionDelay: 20,
    auth: (cb) => cb({ ticket: ticket() }),
  })
  clients.push(s)
  return s
}

const once = <T = unknown>(s: Socket, ev: string) => new Promise<T>((r) => s.once(ev, r as (v: T) => void))

/**
 * A round trip that the server answers only after everything this client
 * sent before it: socket.io handles one connection's packets in order.
 */
async function settled(s: Socket) {
  for (const server of io.of('/').sockets.values()) {
    if (server.listeners('probe').length === 0) server.on('probe', (ack: () => void) => ack())
  }
  await s.timeout(10_000).emitWithAck('probe')
}

afterEach(async () => {
  // Stop reconnect attempts first, so nothing reconnects into the next test.
  clients.splice(0).forEach((c) => {
    c.io.opts.reconnection = false
    c.off()
    c.disconnect()
  })
  ;(global as unknown as { io?: SocketIOServer }).io = undefined
  io.disconnectSockets(true)
  // io.close() also closes the http server it was attached to.
  await new Promise<void>((r) => io.close(() => r()))
})

describe('account namespace', () => {
  it('refuses a connection without a valid ticket', async () => {
    const port = await start()
    const s = client(port, () => 'forged.ticket')
    const err = await once<Error>(s, 'connect_error')
    expect(err.message).toBe('unauthorized')
  })

  it('puts a connection in its ticket’s account room only', async () => {
    const port = await start()
    const s = client(port, () => issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' }))
    await once(s, 'connect')
    s.emit('join_account', 'acc-2')
    await settled(s)
    const [server] = await io.fetchSockets()
    expect([...server.rooms]).toContain('account:acc-1')
    expect([...server.rooms]).not.toContain('account:acc-2')
  })

  it('closes a connection once its lifetime is up', async () => {
    const port = await start(150)
    const s = client(port, () => issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' }))
    await once(s, 'connect')
    const reason = await once<string>(s, 'disconnect')
    expect(reason).toBe('io server disconnect')
  })

  it('cuts off one user’s connections and nobody else’s', async () => {
    const port = await start()
    const gone = client(port, () => issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-gone' }))
    const stays = client(port, () => issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-stays' }))
    await Promise.all([once(gone, 'connect'), once(stays, 'connect')])
    const closed = once<string>(gone, 'disconnect')
    disconnectUserSockets('u-gone')
    expect(await closed).toBe('io server disconnect')
    // Server side: disconnectSockets is synchronous, so this is final.
    const left = await io.fetchSockets()
    expect(left.map((x) => (x.data as { userId?: string }).userId)).toEqual(['u-stays'])
    // Client side: still answered.
    await settled(stays)
    expect(stays.connected).toBe(true)
  })
})

describe('the browser side', () => {
  it('reconnects with a fresh ticket after the server closes it', async () => {
    const port = await start(150)
    let issued = 0
    const s = client(port, () => (issued++, issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' })), true)
    reconnectWhenServerCloses(s)
    await once(s, 'connect')
    await once(s, 'disconnect')
    await once(s, 'connect')
    expect(issued).toBeGreaterThanOrEqual(2)
  })

  it('stays down when the session is gone and no ticket is issued', async () => {
    const port = await start(150)
    let calls = 0
    const s = client(port, () => (calls++ === 0 ? issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' }) : ''), true)
    reconnectWhenServerCloses(s)
    await once(s, 'connect')
    await once(s, 'disconnect')
    const err = await once<Error>(s, 'connect_error')
    expect(err.message).toBe('unauthorized')
    expect(s.connected).toBe(false)
  })
})

describe('CORS for the socket server', () => {
  it('fails closed to same-origin when no site URL is configured', () => {
    expect(socketCorsOrigin({})).toBe(false)
    expect(socketCorsOrigin({ NEXT_PUBLIC_SITE_URL: '  ' })).toBe(false)
    expect(socketCorsOrigin({ NEXT_PUBLIC_SITE_URL: 'https://crm.example.com' })).toBe('https://crm.example.com')
  })
})
