import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { onceSchemaPatch } from "@/lib/db/schema-patch"
import { NextResponse, type NextRequest } from "next/server"

/**
 * The `channel` column, for a database that predates it.
 *
 * ── Why this runs once and not per request ──────────────────────────
 *
 * This used to be awaited inside the GET handler, so every single
 * inbox load — from every agent, all day — sent an ALTER TABLE to
 * Postgres before it was allowed to read anything. `IF NOT EXISTS`
 * makes it a no-op, but a no-op still costs a round trip and still
 * asks the server for a lock on the table the whole app is reading.
 *
 * The column either exists or it does not, and that cannot change
 * while the process is running. So the work happens once and every
 * later caller waits on the same promise.
 */
function ensureChannelColumn(): Promise<void> {
  return onceSchemaPatch('conversations.channel', () => prisma.$executeRaw`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
  `).catch(() => undefined)
}

/**
 * Only the contact fields the list draws.
 *
 * ── Where the weight was ────────────────────────────────────────────
 *
 * A Contact has 49 columns. The inbox list renders a name, a number
 * and a picture. `contact: true` fetched all 49 for every conversation,
 * which is where nearly all of this response's size came from:
 * phone_normalized, external_id, merged_into_contact_id, opt_in_source
 * and the rest, carried across the network so that nothing could look
 * at them.
 *
 * Every field below is one that an inbox or dashboard component was
 * found to read — not a guess at what they might want. Adding a field
 * to the UI means adding it here too, which is the trade for the size.
 */
const CONTACT_FOR_LIST = {
  id: true,
  name: true,
  phone: true,
  avatar_url: true,
  email: true,
  company: true,
  created_at: true,
  detected_language: true,
} as const

/**
 * A page size, when the caller asks for one.
 *
 * ── Why there is no default limit ───────────────────────────────────
 *
 * The obvious fix for a slow list is to stop returning all of it, and
 * here that would be wrong. The inbox filters, searches and counts
 * unread messages entirely in the browser, over whatever this endpoint
 * returned (conversation-list-v2.tsx). Capping the response by default
 * would mean search quietly stopped finding anyone outside the newest
 * page, the Closed tab emptied, and the unread badges under-counted —
 * none of which announces itself as a bug. The screen would simply be
 * wrong, and faster.
 *
 * So the limit is opt-in: available to a caller that knows it only
 * wants a few rows, ignored by the inbox, which genuinely needs all of
 * them until search and filtering move to the server.
 *
 * That move is the real fix, and it is a change to the inbox, not to
 * this file. Until then the honest saving is the one above — sending
 * eight columns per contact instead of forty-nine.
 */
const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    await ensureChannelColumn()

    const asked = Number(req.nextUrl.searchParams.get("limit"))
    const take = Number.isFinite(asked) && asked > 0
      ? Math.min(Math.floor(asked), MAX_LIMIT)
      : undefined

    // Agents can only see conversations explicitly assigned to them
    // (by an admin or by a chatbot handoff). Admins/owners see everything.
    const where = {
      account_id: ctx.accountId,
      ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
    }

    const conversations = await ctx.db.conversation.findMany({
      where,
      orderBy: { last_message_at: "desc" },
      ...(take ? { take } : {}),
      include: {
        contact: { select: CONTACT_FOR_LIST },
        assigned_agent: {
          select: {
            id: true,
            email: true,
            profile: { select: { full_name: true } },
          },
        },
      },
    })
    return NextResponse.json(conversations)
  } catch (err) {
    return toErrorResponse(err)
  }
}
