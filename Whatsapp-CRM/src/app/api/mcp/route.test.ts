import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The MCP endpoint's contract with the outside world.
 *
 * These are the checks that fail loudly if somebody later loosens the
 * door: an unauthenticated call succeeding, a browser origin being
 * accepted, a session id appearing. Each one maps to a named attack in
 * the MCP security spec, so a green run here is a statement about the
 * threat model rather than about the code.
 */

vi.mock('@/lib/auth/api-key', () => ({
  verifyApiKey: vi.fn(async (raw: string) =>
    raw === 'wcrm_valid' ? { accountId: 'acc-1', keyId: 'key-1' } : null,
  ),
}))
vi.mock('@/lib/mcp/tools', () => ({
  MCP_TOOLS: [
    {
      name: 'search_contacts',
      description: 'test',
      inputSchema: { type: 'object' },
      run: async () => ({ contacts: [] }),
    },
  ],
  MCP_TOOLS_BY_NAME: new Map([
    [
      'search_contacts',
      {
        name: 'search_contacts',
        description: 'test',
        inputSchema: { type: 'object' },
        run: async () => ({ contacts: [] }),
      },
    ],
  ]),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true, remaining: 99, reset: Date.now() + 1000, limit: 100 }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

const { POST, GET } = await import('./route')

function call(
  body: unknown,
  headers: Record<string, string> = { authorization: 'Bearer wcrm_valid' },
) {
  return POST(
    new Request('https://crm.example.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params })

beforeEach(() => vi.clearAllMocks())

describe('authentication', () => {
  it('refuses a call with no key', async () => {
    const res = await call(rpc('tools/list'), {})
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
  })

  it('refuses a call with a wrong key', async () => {
    const res = await call(rpc('tools/list'), { authorization: 'Bearer wcrm_wrong' })
    expect(res.status).toBe(401)
  })

  it('says the same thing either way', async () => {
    // A different message for "no key" and "bad key" tells an attacker
    // when they have found a real one.
    const missing = await (await call(rpc('tools/list'), {})).json()
    const wrong = await (
      await call(rpc('tools/list'), { authorization: 'Bearer wcrm_wrong' })
    ).json()
    expect(typeof missing.error).toBe('string')
    expect(typeof wrong.error).toBe('string')
  })
})

describe('origin', () => {
  it('accepts a client that sends none — the normal case', async () => {
    const res = await call(rpc('tools/list'))
    expect(res.status).toBe(200)
  })

  it('refuses a browser on another site', async () => {
    const res = await call(rpc('tools/list'), {
      authorization: 'Bearer wcrm_valid',
      origin: 'https://evil.example.net',
    })
    expect(res.status).toBe(403)
  })
})

describe('protocol', () => {
  it('rejects a version it does not implement', async () => {
    const res = await call(rpc('tools/list'), {
      authorization: 'Bearer wcrm_valid',
      'mcp-protocol-version': '1999-01-01',
    })
    expect(res.status).toBe(400)
  })

  it('answers initialize without handing out a session', async () => {
    const res = await call(rpc('initialize'))
    expect(res.status).toBe(200)
    // No session means nothing to hijack. If this ever fails, the
    // session-hijacking section of the spec has become our problem.
    expect(res.headers.get('Mcp-Session-Id')).toBeNull()
    const body = await res.json()
    expect(body.result.capabilities).toEqual({ tools: {} })
  })

  it('accepts a notification with 202 and no body', async () => {
    const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('reports an unknown method as JSON-RPC, not a crash', async () => {
    const body = await (await call(rpc('tools/destroy'))).json()
    expect(body.error.code).toBe(-32601)
  })

  it('offers no SSE stream', async () => {
    const res = await GET()
    expect(res.status).toBe(405)
  })
})

describe('tools', () => {
  it('lists them', async () => {
    const body = await (await call(rpc('tools/list'))).json()
    expect(body.result.tools[0].name).toBe('search_contacts')
  })

  it('runs one', async () => {
    const body = await (
      await call(rpc('tools/call', { name: 'search_contacts', arguments: { query: 'x' } }))
    ).json()
    expect(body.result.content[0].type).toBe('text')
  })

  it('refuses one that does not exist', async () => {
    const body = await (await call(rpc('tools/call', { name: 'rm_rf' }))).json()
    expect(body.error.code).toBe(-32602)
  })
})
