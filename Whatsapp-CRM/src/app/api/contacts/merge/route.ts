import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * POST /api/contacts/merge — { survivor_id, merged_id, field_choices? }
 *
 * IG·04 — collapses two Contact rows (e.g. one from a WhatsApp inbound,
 * one from an Instagram DM) that turned out to be the same person, into
 * one. Deliberately manual: this app never auto-merges (the same caution
 * already applied to opt-in status) — a human explicitly picks both sides
 * and confirms.
 *
 * `merged_id`'s Contact row is soft-deleted (merged_into_contact_id set),
 * never hard-deleted — every FK pointing at it (conversations, deals,
 * leads, tags, etc.) stays valid.
 *
 * field_choices lets the caller resolve conflicts explicitly (e.g. both
 * contacts have a different `name`) — { name: 'survivor' | 'merged' }.
 * Any field not listed defaults to the conservative rule: keep the
 * survivor's value if it has one, otherwise take the merged contact's.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const body = await req.json().catch(() => null) as {
      survivor_id?: string
      merged_id?: string
      field_choices?: Record<string, "survivor" | "merged">
    } | null
    if (!body?.survivor_id || !body?.merged_id) {
      return NextResponse.json({ error: "survivor_id and merged_id are required" }, { status: 400 })
    }
    if (body.survivor_id === body.merged_id) {
      return NextResponse.json({ error: "Can't merge a contact with itself" }, { status: 400 })
    }

    const [survivor, merged] = await Promise.all([
      prisma.contact.findFirst({ where: { id: body.survivor_id, account_id: ctx.accountId } }),
      prisma.contact.findFirst({ where: { id: body.merged_id, account_id: ctx.accountId } }),
    ])
    if (!survivor || !merged) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (merged.merged_into_contact_id) {
      return NextResponse.json({ error: "That contact was already merged into another one." }, { status: 400 })
    }

    const choices = body.field_choices ?? {}
    const mergedFields: Record<string, unknown> = {}
    for (const field of ["name", "email", "company", "gender", "avatar_url", "alternate_phone"] as const) {
      const choice = choices[field]
      if (choice === "merged") {
        mergedFields[field] = merged[field]
      } else if (choice === "survivor") {
        mergedFields[field] = survivor[field]
      } else {
        // Conservative default: keep the survivor's own value if it has
        // one, otherwise fill in from the merged contact — never silently
        // overwrite a survivor value that already exists.
        mergedFields[field] = survivor[field] ?? merged[field]
      }
    }
    // instagram_id/facebook_id are always carried over when the survivor
    // doesn't already have one — this is the actual point of the merge
    // (letting the survivor be reachable across both channels).
    if (!survivor.instagram_id && merged.instagram_id) mergedFields.instagram_id = merged.instagram_id
    if (!survivor.facebook_id && merged.facebook_id) mergedFields.facebook_id = merged.facebook_id

    const relationUpdates = await prisma.$transaction(async (tx) => {
      // Re-point every relation that hangs off Contact — enumerated
      // directly from the Contact model's own relation list
      // (prisma/schema.prisma) rather than guessed.
      const conversations = await tx.conversation.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const deals = await tx.deal.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const broadcastRecipients = await tx.broadcastRecipient.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const automationLogs = await tx.automationLog.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const automationPending = await tx.automationPendingExecution.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const flowRuns = await tx.flowRun.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const leads = await tx.lead.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const followUps = await tx.followUp.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const leadActivities = await tx.leadActivity.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const tasks = await tx.task.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const scheduledMessages = await tx.scheduledMessage.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })
      const notes = await tx.contactNote.updateMany({ where: { contact_id: merged.id }, data: { contact_id: survivor.id } })

      // Tags/custom values have a compound unique key with contact_id — a
      // blind updateMany could collide if the survivor already has the
      // same tag/field. Move only the ones that don't already exist on
      // the survivor, then drop the rest (they're now redundant, not lost
      // — the merged contact's full snapshot is preserved in ContactMerge).
      const mergedTags = await tx.contactTag.findMany({ where: { contact_id: merged.id } })
      let tagsMoved = 0
      for (const t of mergedTags) {
        const exists = await tx.contactTag.findUnique({ where: { contact_id_tag_id: { contact_id: survivor.id, tag_id: t.tag_id } } })
        if (!exists) {
          await tx.contactTag.update({ where: { contact_id_tag_id: { contact_id: merged.id, tag_id: t.tag_id } }, data: { contact_id: survivor.id } })
          tagsMoved++
        } else {
          await tx.contactTag.delete({ where: { contact_id_tag_id: { contact_id: merged.id, tag_id: t.tag_id } } })
        }
      }

      const mergedFieldValues = await tx.contactCustomValue.findMany({ where: { contact_id: merged.id } })
      let fieldsMoved = 0
      for (const v of mergedFieldValues) {
        const exists = await tx.contactCustomValue.findUnique({ where: { contact_id_custom_field_id: { contact_id: survivor.id, custom_field_id: v.custom_field_id } } })
        if (!exists) {
          await tx.contactCustomValue.update({ where: { contact_id_custom_field_id: { contact_id: merged.id, custom_field_id: v.custom_field_id } }, data: { contact_id: survivor.id } })
          fieldsMoved++
        }
      }

      await tx.contact.update({
        where: { id: survivor.id },
        data: mergedFields,
      })
      await tx.contact.update({
        where: { id: merged.id },
        data: { merged_into_contact_id: survivor.id },
      })
      await tx.contactMerge.create({
        data: {
          account_id: ctx.accountId,
          survivor_contact_id: survivor.id,
          merged_contact_id: merged.id,
          // Dates in `merged` need a JSON round-trip first — Prisma's Json
          // input type wants plain JSON-serializable values, not Date objects.
          merged_contact_snapshot: JSON.parse(JSON.stringify(merged)),
          performed_by_user_id: ctx.userId,
        },
      })

      return {
        conversations: conversations.count,
        deals: deals.count,
        leads: leads.count,
        tags_moved: tagsMoved,
        fields_moved: fieldsMoved,
        follow_ups: followUps.count,
        lead_activities: leadActivities.count,
        tasks: tasks.count,
        scheduled_messages: scheduledMessages.count,
        notes: notes.count,
        broadcast_recipients: broadcastRecipients.count,
        automation_logs: automationLogs.count,
        automation_pending_executions: automationPending.count,
        flow_runs: flowRuns.count,
      }
    })

    const updatedSurvivor = await prisma.contact.findUnique({ where: { id: survivor.id } })

    return NextResponse.json({ success: true, survivor: updatedSurvivor, moved: relationUpdates })
  } catch (err) {
    return toErrorResponse(err)
  }
}
