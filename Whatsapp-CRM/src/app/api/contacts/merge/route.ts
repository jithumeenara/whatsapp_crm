import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { mergeContacts, MergeError, type FieldChoice } from "@/lib/contacts/merge"

/**
 * POST /api/contacts/merge — { survivor_id, merged_id, field_choices? }
 *
 * IG·04 — collapses two Contact rows (e.g. one from a WhatsApp inbound,
 * one from an Instagram DM) that turned out to be the same person, into
 * one. Deliberately manual: this app never auto-merges — a human picks
 * both sides and confirms. The work is in src/lib/contacts/merge.ts,
 * shared with "Find duplicates".
 *
 * field_choices resolves conflicts explicitly (both have a different
 * `name`): { name: 'survivor' | 'merged' }. Unlisted fields keep the
 * survivor's value when it has one, otherwise take the merged contact's.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const body = await req.json().catch(() => null) as {
      survivor_id?: unknown
      merged_id?: unknown
      field_choices?: Record<string, unknown>
    } | null
    if (typeof body?.survivor_id !== "string" || typeof body?.merged_id !== "string") {
      return NextResponse.json({ error: "survivor_id and merged_id are required" }, { status: 400 })
    }
    const choices: Record<string, FieldChoice> = {}
    for (const [k, v] of Object.entries(body.field_choices ?? {})) {
      if (v === "survivor" || v === "merged") choices[k] = v
    }
    try {
      const result = await mergeContacts({
        accountId: ctx.accountId,
        userId: ctx.userId,
        survivorId: body.survivor_id,
        mergedId: body.merged_id,
        fieldChoices: choices,
      })
      return NextResponse.json({ success: true, survivor: result.survivor, moved: result.moved })
    } catch (err) {
      if (err instanceof MergeError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
