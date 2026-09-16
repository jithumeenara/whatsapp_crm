import { NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/auth/api-key'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { MCP_TOOLS, MCP_TOOLS_BY_NAME } from '@/lib/mcp/tools'

/**
 * This CRM, as a Model Context Protocol server.
 *
 * Lets an assistant answer "how many leads came in this week?" or "what
 * did we tell that customer?" from the real records instead of a guess or
 * a screenshot. One endpoint, POST only, JSON-RPC over HTTP — the
 * Streamable HTTP transport, in its simplest legal form.
 *
 * ── Why it is built the way it is ────────────────────────────────────
 *
 * MCP servers turned out to be a soft target in 2025-26 — a survey of a
 * thousand of them found critical flaws in a third, command injection in
 * 43% and path traversal in 82%. Almost all of that comes from servers
 * that run things. Every decision below is an attempt to be the boring
 * kind of server instead:
 *
 * **Stateless, with no session at all.** The spec's session-hijacking
 * section is long, and every mitigation in it is a way of making a
 * session ID harder to steal or reuse. This server issues none: no
 * `Mcp-Session-Id`, nothing held between requests, so there is nothing to
 * hijack. Its own words — "MCP Servers MUST NOT use sessions for
 * authentication" — are satisfied by having no sessions to misuse.
 *
 * **Every request authenticated on its own.** An API key this app issued
 * for this app, hashed at rest and compared in constant time. Not a token
 * minted elsewhere and waved through: "MCP servers MUST NOT accept any
 * tokens that were not explicitly issued for the MCP server."
 *
 * **Read-only, and that is the real defence.** Tool results carry text
 * customers wrote — messages, names, knowledge entries — and text that
 * reaches a model's context is an injection risk that no amount of
 * escaping fixes. What makes it survivable is that a successful injection
 * has nothing to reach for: nothing here sends a message, moves a lead,
 * or deletes a row. Writes are a separate decision, deliberately not
 * taken here.
 *
 * **No shell, no filesystem, no fetch.** The two most common flaws in the
 * survey above cannot occur: no tool takes a path or a command, and every
 * query goes through Prisma's parameterisation.
 *
 * Not applicable, and worth saying so: the confused-deputy problem is an
 * OAuth-proxy attack, and this server proxies nothing; SSRF belongs to
 * clients that fetch discovery URLs, and this one fetches nothing.
 */

export const dynamic = 'force-dynamic'

/** Versions whose request shape this server actually implements. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

/** Generous for an assistant working through a question, and a hard stop
 *  on anything walking the tool list in a loop. Keyed by API key, so one
 *  noisy integration cannot starve another. */
const MCP_RATE_LIMIT = { limit: 120, windowMs: 60_000 }

const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

type JsonRpcId = string | number | null

function rpcError(id: JsonRpcId, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status })
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result })
}

/**
 * Reject a browser that was talked into calling this endpoint.
 *
 * The spec requires validating Origin on every connection, to stop DNS
 * rebinding. A real MCP client is not a browser and sends no Origin at
 * all, so an absent header is the normal case; a present one has to be
 * this app's own. Anything else is a page somewhere else on the internet
 * trying to use a visitor's credentials, and the credentials here are not
 * cookies — but the check costs nothing and the spec is unambiguous.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true

  const configured = process.env.NEXT_PUBLIC_APP_URL
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const allowed = new Set<string>()
  if (configured) {
    try {
      allowed.add(new URL(configured).host)
    } catch {
      // A malformed app URL should not open the endpoint up.
    }
  }
  if (host) allowed.add(host)

  try {
    return allowed.has(new URL(origin).host)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return rpcError(null, JSONRPC_ERRORS.invalidRequest, 'Origin not allowed', 403)
  }

  // "If the server receives a request with an invalid or unsupported
  // MCP-Protocol-Version, it MUST respond with 400 Bad Request." Absent
  // is allowed — the spec says to assume 2025-03-26 in that case.
  const version = request.headers.get('mcp-protocol-version')
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return rpcError(
      null,
      JSONRPC_ERRORS.invalidRequest,
      `Unsupported MCP-Protocol-Version: ${version}`,
      400,
    )
  }

  const authorization = request.headers.get('authorization') ?? ''
  const rawKey = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!rawKey) {
    return NextResponse.json(
      { error: 'An API key is required. Send it as: Authorization: Bearer <key>' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    )
  }

  const key = await verifyApiKey(rawKey).catch(() => null)
  if (!key) {
    // Deliberately identical to the missing-key case. Telling an attacker
    // that a key existed but was wrong is a hint worth withholding.
    return NextResponse.json(
      { error: 'Invalid API key.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    )
  }

  const limit = checkRateLimit(`mcp:${key.keyId}`, MCP_RATE_LIMIT)
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as {
    jsonrpc?: string
    id?: JsonRpcId
    method?: string
    params?: Record<string, unknown>
  } | null

  if (!body) return rpcError(null, JSONRPC_ERRORS.parse, 'Could not parse the request body', 400)
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id ?? null, JSONRPC_ERRORS.invalidRequest, 'Not a JSON-RPC 2.0 request', 400)
  }

  const id = body.id ?? null
  const method = body.method

  // A notification carries no id and expects no answer. "the server MUST
  // return HTTP status code 202 Accepted with no body."
  if (body.id === undefined) {
    return new Response(null, { status: 202 })
  }

  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: version ?? DEFAULT_PROTOCOL_VERSION,
          // Tools only. No resources, no prompts, no sampling — each is
          // another surface, and none is needed to answer questions about
          // the CRM.
          capabilities: { tools: {} },
          serverInfo: { name: 'whatsapp-crm', version: '1.0.0' },
          instructions:
            'Read-only access to this WhatsApp CRM: contacts, leads, ' +
            'conversations, the assistant’s knowledge base, and how the ' +
            'assistant has been performing. Nothing here can send a message ' +
            'or change a record.',
        })

      case 'ping':
        return rpcResult(id, {})

      case 'tools/list':
        return rpcResult(id, {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        })

      case 'tools/call': {
        const name = String(body.params?.name ?? '')
        const tool = MCP_TOOLS_BY_NAME.get(name)
        if (!tool) {
          return rpcError(id, JSONRPC_ERRORS.invalidParams, `No such tool: ${name}`)
        }
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>

        try {
          const output = await tool.run(args, key.accountId)
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          })
        } catch (err) {
          // Reported as a tool failure rather than a protocol error, which
          // is what lets the model read it and try something else. The
          // message is ours, not the database's — a Prisma error can name
          // columns and constraints, and that is free reconnaissance.
          console.error(`[mcp] ${name} failed:`, err instanceof Error ? err.message : err)
          return rpcResult(id, {
            isError: true,
            content: [{ type: 'text', text: `The ${name} tool could not complete.` }],
          })
        }
      }

      default:
        return rpcError(id, JSONRPC_ERRORS.methodNotFound, `Unknown method: ${method}`)
    }
  } catch (err) {
    console.error('[mcp]', err)
    return rpcError(id, JSONRPC_ERRORS.internal, 'Internal error')
  }
}

/**
 * No server-initiated stream.
 *
 * The spec allows exactly this: "the server MUST either return
 * Content-Type: text/event-stream in response to this HTTP GET, or else
 * return HTTP 405 Method Not Allowed." Nothing here pushes anything at a
 * client, so an open stream would be a connection held for no reason.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'This server does not offer an SSE stream. POST JSON-RPC instead.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

/** Sessions do not exist here, so there is none to end. */
export async function DELETE() {
  return NextResponse.json(
    { error: 'This server is stateless and holds no session.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
