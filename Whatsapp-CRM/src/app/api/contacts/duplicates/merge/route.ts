import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { mergeContacts, MergeError } from "@/lib/contacts/merge"

/**
 * POST /api/contacts/duplicates/merge   { survivor_id, merged_ids: [..] }
 *
 * Merges a group from "Find duplicates" into the one contact kept, one at
 * a time through the same merge as "Merge contacts". Each merge stands on
 * its own: one that fails (already merged elsewhere, say) is reported and
 * the rest go ahead. Pressing twice is harmless — an already-merged
 * contact is refused, not merged again.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const body = (await req.json().catch(() => null)) as { survivor_id?: unknown; merged_ids?: unknown } | null
    const survivorId = typeof body?.survivor_id === "string" ? body.survivor_id : ""
    const mergedIds = Array.isArray(body?.merged_ids)
      ? [...new Set((body.merged_ids as unknown[]).filter((v): v is string => typeof v === "string" && v !== survivorId))].slice(0, 20)
      : []
    if (!survivorId || mergedIds.length === 0) {
      return NextResponse.json({ error: "Choose the contact to keep and at least one to merge into it." }, { status: 400 })
    }

    let merged = 0
    const failed: Array<{ id: string; error: string }> = []
    for (const id of mergedIds) {
      try {
        await mergeContacts({ accountId: ctx.accountId, userId: ctx.userId, survivorId, mergedId: id })
        merged++
      } catch (err) {
        if (err instanceof MergeError) failed.push({ id, error: err.message })
        else {
          console.error("[contacts/duplicates/merge]", err)
          failed.push({ id, error: "Could not merge this one." })
        }
      }
    }
    if (merged === 0) return NextResponse.json({ error: failed[0]?.error ?? "Nothing was merged.", failed }, { status: 409 })
    return NextResponse.json({ merged, failed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
