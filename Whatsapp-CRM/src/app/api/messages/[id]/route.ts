import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"

async function ensureDeletedAtColumn() {
  await prisma.$executeRaw`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `.catch(() => {})
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

    // ── Call platform delete API ──────────────────────────────────────────────
    if (platformMid) {
      if (channel === "instagram") {
        await deleteInstagramMessage(user.accountId, platformMid)
      } else {
        await deleteWhatsAppMessage(user.accountId, platformMid)
      }
    }

    // ── Soft-delete in DB ─────────────────────────────────────────────────────
    await prisma.$executeRaw`
      UPDATE messages SET deleted_at = now() WHERE id = ${id}::uuid
    `

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[DELETE /api/messages/[id]]", msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

async function deleteWhatsAppMessage(accountId: string, messageId: string) {
  const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: accountId } })
  if (!config) throw new Error("WhatsApp not configured")
  const accessToken = decrypt(config.access_token)

  const res = await fetch(
    `https://graph.facebook.com/v17.0/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message: string } }
    // 131009 = message too old or already deleted — treat as success
    if ((data as { error?: { code?: number } }).error?.code === 131009) return
    throw new Error(data.error?.message ?? `WhatsApp delete failed: ${res.status}`)
  }
}

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
