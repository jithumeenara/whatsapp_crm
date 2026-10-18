/**
 * Merging two contacts that are one person — used by "Merge contacts" and
 * by "Find duplicates".
 *
 * The absorbed contact is soft-deleted (merged_into_contact_id), never
 * deleted: everything pointing at it moves to the contact that is kept,
 * and its full snapshot stays in contact_merges. A message that later
 * arrives from the absorbed contact's number lands on the kept one
 * (findExistingContact follows merged_into_contact_id).
 *
 * Everything that hangs off a contact moves — the Prisma relations, and
 * the tables written with raw SQL that Prisma does not model. When both
 * are in the middle of a chatbot, the absorbed one's run ends first: one
 * active run per contact is a database rule, and breaking it used to make
 * the whole merge fail.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type FieldChoice = 'survivor' | 'merged'
const CHOOSABLE = ['name', 'email', 'company', 'gender', 'avatar_url', 'alternate_phone'] as const

/** Tables with a contact_id that Prisma does not model — moved by name.
 *  Fixed names only; each is skipped where the table does not exist. */
const RAW_TABLES = ['catalog_orders', 'registration_drafts'] as const

export class MergeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MergeError'
  }
}

export async function mergeContacts(args: {
  accountId: string
  userId: string
  survivorId: string
  mergedId: string
  fieldChoices?: Partial<Record<(typeof CHOOSABLE)[number], FieldChoice>>
}) {
  if (args.survivorId === args.mergedId) throw new MergeError("Can't merge a contact with itself", 400)
  const [survivor, merged] = await Promise.all([
    prisma.contact.findFirst({ where: { id: args.survivorId, account_id: args.accountId } }),
    prisma.contact.findFirst({ where: { id: args.mergedId, account_id: args.accountId } }),
  ])
  if (!survivor || !merged) throw new MergeError('Not found', 404)
  if (merged.merged_into_contact_id) throw new MergeError('That contact was already merged into another one.', 400)
  if (survivor.merged_into_contact_id) throw new MergeError('The contact to keep was itself merged into another one.', 400)

  const choices = args.fieldChoices ?? {}
  const mergedFields: Record<string, unknown> = {}
  for (const field of CHOOSABLE) {
    // Default: keep the survivor's value when it has one, else take the other's.
    mergedFields[field] = choices[field] === 'merged' ? merged[field] : survivor[field] ?? merged[field]
  }
  if (!survivor.instagram_id && merged.instagram_id) mergedFields.instagram_id = merged.instagram_id
  if (!survivor.facebook_id && merged.facebook_id) mergedFields.facebook_id = merged.facebook_id
  // The person stays opted out if either record had opted out.
  if (merged.opt_in_status === 'opted_out' && survivor.opt_in_status !== 'opted_out') {
    mergedFields.opt_in_status = 'opted_out'
    mergedFields.opted_out_at = merged.opted_out_at ?? new Date()
  }

  const moved = await prisma.$transaction(async (tx) => {
    const to = { contact_id: survivor.id }
    const from = { contact_id: merged.id }

    // One active chatbot run per contact: end the absorbed one's first.
    const survivorRunning = await tx.flowRun.count({ where: { contact_id: survivor.id, status: 'active' } })
    if (survivorRunning > 0) {
      await tx.flowRun.updateMany({
        where: { contact_id: merged.id, status: 'active' },
        data: { status: 'completed', ended_at: new Date(), end_reason: 'contact_merged' },
      })
    }

    const counts: Record<string, number> = {}
    const move = async (name: string, p: Promise<{ count: number }>) => { counts[name] = (await p).count }
    await move('conversations', tx.conversation.updateMany({ where: from, data: to }))
    await move('deals', tx.deal.updateMany({ where: from, data: to }))
    await move('broadcast_recipients', tx.broadcastRecipient.updateMany({ where: from, data: to }))
    await move('automation_logs', tx.automationLog.updateMany({ where: from, data: to }))
    await move('automation_pending_executions', tx.automationPendingExecution.updateMany({ where: from, data: to }))
    await move('flow_runs', tx.flowRun.updateMany({ where: from, data: to }))
    await move('leads', tx.lead.updateMany({ where: from, data: to }))
    await move('follow_ups', tx.followUp.updateMany({ where: from, data: to }))
    await move('lead_activities', tx.leadActivity.updateMany({ where: from, data: to }))
    await move('tasks', tx.task.updateMany({ where: from, data: to }))
    await move('scheduled_messages', tx.scheduledMessage.updateMany({ where: from, data: to }))
    await move('notes', tx.contactNote.updateMany({ where: from, data: to }))
    await move('ai_lead_reviews', tx.aiLeadReview.updateMany({ where: from, data: to }))
    await move('ai_judgements', tx.aiJudgement.updateMany({ where: from, data: to }))
    await move('calls', tx.call.updateMany({ where: from, data: to }))
    await move('feedback', tx.conversationFeedback.updateMany({ where: from, data: to }))
    await move('data_records', tx.dataRecord.updateMany({ where: from, data: to }))
    await move('payments', tx.whatsAppPayment.updateMany({ where: from, data: to }))
    await move('web_chat_sessions', tx.webChatSession.updateMany({ where: from, data: to }))
    for (const table of RAW_TABLES) {
      const exists = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`SELECT to_regclass(${table}) IS NOT NULL AS ok`)
      if (!exists[0]?.ok) continue
      counts[table] = await tx.$executeRaw(
        Prisma.sql`UPDATE ${Prisma.raw(table)} SET contact_id = ${survivor.id}::uuid WHERE contact_id = ${merged.id}::uuid`,
      )
    }

    // Keyed on (x, contact_id): move what the survivor lacks, drop the rest
    // (kept in the snapshot, not lost).
    const mergedTags = await tx.contactTag.findMany({ where: from })
    let tagsMoved = 0
    for (const t of mergedTags) {
      const exists = await tx.contactTag.findUnique({ where: { contact_id_tag_id: { contact_id: survivor.id, tag_id: t.tag_id } } })
      if (!exists) {
        await tx.contactTag.update({ where: { contact_id_tag_id: { contact_id: merged.id, tag_id: t.tag_id } }, data: to })
        tagsMoved++
      } else {
        await tx.contactTag.delete({ where: { contact_id_tag_id: { contact_id: merged.id, tag_id: t.tag_id } } })
      }
    }
    counts.tags_moved = tagsMoved

    const mergedValues = await tx.contactCustomValue.findMany({ where: from })
    let fieldsMoved = 0
    for (const v of mergedValues) {
      const exists = await tx.contactCustomValue.findUnique({ where: { contact_id_custom_field_id: { contact_id: survivor.id, custom_field_id: v.custom_field_id } } })
      if (!exists) {
        await tx.contactCustomValue.update({ where: { contact_id_custom_field_id: { contact_id: merged.id, custom_field_id: v.custom_field_id } }, data: to })
        fieldsMoved++
      }
    }
    counts.fields_moved = fieldsMoved

    const memberships = await tx.contactListMember.findMany({ where: from, select: { list_id: true } })
    if (memberships.length) {
      await tx.contactListMember.createMany({ data: memberships.map((m) => ({ list_id: m.list_id, contact_id: survivor.id })), skipDuplicates: true })
      await tx.contactListMember.deleteMany({ where: from })
    }
    counts.list_memberships = memberships.length

    await tx.contact.update({ where: { id: survivor.id }, data: mergedFields })
    await tx.contact.update({ where: { id: merged.id }, data: { merged_into_contact_id: survivor.id } })
    await tx.contactMerge.create({
      data: {
        account_id: args.accountId,
        survivor_contact_id: survivor.id,
        merged_contact_id: merged.id,
        merged_contact_snapshot: JSON.parse(JSON.stringify(merged)),
        performed_by_user_id: args.userId,
      },
    })
    return counts
  }, { timeout: 30_000 })

  const updated = await prisma.contact.findUnique({ where: { id: survivor.id } })
  return { survivor: updated, moved }
}
