import { NextRequest, NextResponse } from "next/server"
import { onceSchemaPatch } from "@/lib/db/schema-patch"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from "@/lib/whatsapp/resolve-config"

// Same key as the two read routes, so whichever runs first covers all
// three for the lifetime of the process.
async function ensureDeletedAtColumn() {
  await onceSchemaPatch('messages.deleted_at', () => prisma.$executeRaw`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `).catch(() => {})
}

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) return null
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return null
  return { userId: session.user.id, accountId: profile.account_id }
}

/** DELETE /api/messages/[id] — unsend on platform then soft-delete in DB */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await ensureDeletedAtColumn()

    // Verify the message belongs to this account
    const msg = await prisma.message.findFirst({
      where: { id },
      include: { conversation: { select: { account_id: true, channel: true } } },
    })
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const conv = msg.conversation as { account_id: string; channel?: string } | null
    if (conv?.account_id !== user.accountId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({})) as { channel?: string; message_id?: string }
    const channel = body.channel ?? (conv as { channel?: string })?.channel ?? "whatsapp"
    const platformMid = body.message_id ?? msg.message_id

    // ── Unsend on the platform, where the platform allows it ────────────────
    //
    // Instagram and Messenger do: DELETE /{message-id} removes the
    // message from the recipient's app, which is what "delete for
    // everyone" means.
    //
    // WhatsApp does not, and this route used to try anyway — the same
    // DELETE call, copied across. Meta answers it exactly as you would
    // expect: "does not exist, cannot be loaded due to missing
    // permissions, or does not support this operation." The request
    // then threw, the optimistic removal was rolled back, and the agent
    // saw "Delete failed" with the message still sitting there.
    //
    // Checked against Meta's own reference rather than assumed: the
    // Messages endpoint documents POST and nothing else, and the one
    // "revoke" in the WhatsApp docs is an inbound webhook telling a
    // business that a *customer* deleted their own message. There is no
    // business-side unsend. The phone app has one; the Cloud API does
    // not expose it.
    //
    // So WhatsApp is removed here and only here. Saying so is the
    // honest half of the fix — see `removed_here_only` below, which is
    // what the inbox tells the agent.
    const platformUnsends = channel === "instagram" || channel === "facebook"

    if (platformMid && platformUnsends) {
      if (channel === "instagram") {
        await deleteInstagramMessage(user.accountId, platformMid)
      } else {
        await deleteFacebookMessage(user.accountId, platformMid)
      }
    }

    // ── Soft-delete in DB ─────────────────────────────────────────────────────
    await prisma.$executeRaw`
      UPDATE messages SET deleted_at = now() WHERE id = ${id}::uuid
    `

    // The agent needs to know which of the two just happened. A
    // message gone from their screen but still on the customer's phone
    // is a different fact from one that is gone from both, and the
    // difference matters the moment they wonder whether to ring and
    // apologise.
    return NextResponse.json({ ok: true, removed_here_only: !platformUnsends })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[DELETE /api/messages/[id]]", msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

// deleteWhatsAppMessage used to live here. It called
// DELETE /{wamid} on the Graph API, which WhatsApp has never supported
// for a business's own messages — see the note in the DELETE handler.
// Removed rather than left behind, because an unused helper that looks
// like it works is an invitation to call it again.

async function deleteInstagramMessage(accountId: string, messageId: string) {
  const rows = await prisma.$queryRaw<{ access_token: string }[]>`
    SELECT access_token FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `.catch(() => [] as { access_token: string }[])
  const token = rows[0]?.access_token
  if (!token) throw new Error("Instagram not configured")

  const res = await fetch(
    `https://graph.instagram.com/v21.0/${encodeURIComponent(messageId)}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message: string } }
    throw new Error(data.error?.message ?? `Instagram unsend failed: ${res.status}`)
  }
}

async function deleteFacebookMessage(accountId: string, messageId: string) {
  const rows = await prisma.$queryRaw<{ access_token: string }[]>`
    SELECT access_token FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `.catch(() => [] as { access_token: string }[])
  const token = rows[0]?.access_token
  if (!token) throw new Error("Facebook not configured")

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(messageId)}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message: string } }
    throw new Error(data.error?.message ?? `Facebook unsend failed: ${res.status}`)
  }
}
