import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { containsPattern, MAX_QUERY, MAX_RESULTS, messageSnippet, MIN_QUERY } from "@/lib/inbox/message-search"

interface Row {
  id: string
  conversation_id: string
  sender_type: string
  content_text: string | null
  email_subject: string | null
  media_filename: string | null
  created_at: Date
  status: string
  channel: string | null
  contact_name: string | null
  contact_phone: string | null
}

/** A slow search gives up with a message; it never holds a connection. */
const SEARCH_TIMEOUT_MS = 8_000
const FILTER_VALUE = /^[a-z_]{1,20}$/

/** GET /api/conversations/search?q=&status=&channel= — messages containing
 *  the text, newest first, in the conversations this person may open. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const limit = checkRateLimit(`inbox-search:${ctx.userId}`, RATE_LIMITS.apiRead)
    if (!limit.success) return rateLimitResponse(limit)

    const params = req.nextUrl.searchParams
    const q = (params.get("q") ?? "").trim()
    if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
      return NextResponse.json({ error: `Type ${MIN_QUERY} to ${MAX_QUERY} characters to search.` }, { status: 400 })
    }
    const status = params.get("status") ?? ""
    const channel = params.get("channel") ?? ""
    const pattern = containsPattern(q)

    // The same rules as the Inbox list and the message thread: this
    // account, an agent's own conversations, no archived contacts.
    const agentSql = ctx.role === "agent" ? Prisma.sql`AND c.assigned_agent_id = ${ctx.userId}::uuid` : Prisma.empty
    const statusSql = FILTER_VALUE.test(status) ? Prisma.sql`AND c.status = ${status}` : Prisma.empty
    const channelSql = FILTER_VALUE.test(channel) ? Prisma.sql`AND COALESCE(c.channel, 'whatsapp') = ${channel}` : Prisma.empty

    const rows = await ctx.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(SEARCH_TIMEOUT_MS)}, true)`
      return tx.$queryRaw<Row[]>`
        SELECT m.id, m.conversation_id, m.sender_type, m.content_text, m.email_subject, m.media_filename,
               m.created_at, c.status, c.channel, ct.name AS contact_name, ct.phone AS contact_phone
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.account_id = ${ctx.accountId}::uuid
          AND ct.archived_at IS NULL
          AND m.deleted_at IS NULL
          ${agentSql}
          ${statusSql}
          ${channelSql}
          AND (m.content_text ILIKE ${pattern} ESCAPE '\\'
            OR m.email_subject ILIKE ${pattern} ESCAPE '\\'
            OR m.media_filename ILIKE ${pattern} ESCAPE '\\')
        ORDER BY m.created_at DESC
        LIMIT ${MAX_RESULTS + 1}
      `
    }, { timeout: SEARCH_TIMEOUT_MS + 2_000, maxWait: 5_000 })

    const lower = q.toLowerCase()
    const matchedText = (r: Row) =>
      [r.content_text, r.email_subject, r.media_filename].find((t) => t?.toLowerCase().includes(lower)) ?? r.content_text

    return NextResponse.json({
      results: rows.slice(0, MAX_RESULTS).map((r) => ({
        id: r.id,
        conversation_id: r.conversation_id,
        sender_type: r.sender_type,
        snippet: messageSnippet(matchedText(r), q),
        created_at: r.created_at,
        status: r.status,
        channel: r.channel,
        contact_name: r.contact_name,
        contact_phone: r.contact_phone,
      })),
      more: rows.length > MAX_RESULTS,
    })
  } catch (err) {
    // 57014: the statement timeout above.
    if ((err as { meta?: { code?: string } })?.meta?.code === "57014" || String((err as Error)?.message).includes("57014")) {
      console.error("[conversations/search] timed out")
      return NextResponse.json({ error: "That search took too long. Try a longer word." }, { status: 503 })
    }
    return toErrorResponse(err)
  }
}
