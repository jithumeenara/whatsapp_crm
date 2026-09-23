import { prisma } from '@/lib/db'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/**
 * "I have retired — ring the new secretary on this number."
 *
 * ── The situation this is for ───────────────────────────────────────
 *
 * ACSTI's records hold a society's secretary by their personal number.
 * Secretaries retire at an age and a new one takes over, but the number
 * on file does not change. So the person who answers says they have
 * retired and gives the new secretary's number, and that is the end of
 * it — the CRM still holds the old number, and the next campaign rings
 * the same retired person again.
 *
 * The assistant used to make it worse. Told "I am retired from
 * service", it asked whether they wanted details of the training
 * programmes: a person who had just said they no longer work, offered
 * staff training, by a business that a moment earlier had promised to
 * call them back.
 *
 * ── Why this records and does not update ────────────────────────────
 *
 * The obvious version replaces the contact's phone number. It would be
 * wrong, and not for a reason in the code.
 *
 * A number arrives here as text — read out by one person, typed by
 * another, sometimes a digit short, usually without a country code.
 * `normalizePhone` keeps the digits and adds nothing, so "9526218159"
 * stays ten digits and is not a number WhatsApp can reach. Writing that
 * over an organisation's only working contact loses the one that worked
 * and leaves nothing that does, silently.
 *
 * Creating a contact row for it is the same mistake one step removed: a
 * row nobody has spoken to, holding a number that may not dial.
 *
 * So this writes down what was said and asks a person to ring it. The
 * note is on the record where somebody will see it, the task is on
 * somebody's list, and the ten seconds of judgement that decides
 * whether a number is real stays with a human.
 */

export interface HandoverResult {
  recorded: boolean
  /** What the assistant should do with this, in its own words. */
  note: string
}

/** Enough digits to be a phone number at all. Deliberately loose: the
 *  point is to reject "call the office" and "I'll send it later", not
 *  to decide whether a number dials — a person is about to do that. */
const MIN_DIGITS = 7
const MAX_DIGITS = 15

export async function recordContactHandover(args: {
  accountId: string
  /** The contact who says they have handed over. */
  fromContactId: string
  /** The number they gave, as they wrote it. */
  newPhone: string
  /** The incoming person's name, if they gave one. */
  newName?: string | null
  /** What the outgoing person actually said. */
  said?: string | null
  /** Who should confirm it, when the conversation has an owner. */
  userId?: string | null
}): Promise<HandoverResult> {
  const from = await prisma.contact.findFirst({
    where: { id: args.fromContactId, account_id: args.accountId },
    select: { id: true, name: true, phone: true, company: true },
  })
  if (!from) return { recorded: false, note: 'That contact could not be found.' }

  const digits = normalizePhone(args.newPhone)
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return {
      recorded: false,
      note: 'That does not look like a phone number. Ask them to send it again, and do not say anything has been recorded.',
    }
  }

  if (digits === normalizePhone(from.phone)) {
    return {
      recorded: false,
      note: 'That is the number we are already speaking to them on. Ask whether they meant a different one.',
    }
  }

  const owner = await anyOwnerOf(args.accountId)
  if (!owner) return { recorded: false, note: 'Could not record this. A colleague will follow up.' }

  // The organisation is the thing that persists; the person is the part
  // that changes. Whoever reads the task needs to know which society.
  const org = from.company?.trim() || from.name?.trim() || 'this contact'
  const who = args.newName?.trim()
  const said = args.said?.trim().slice(0, 300)

  // The number exactly as it arrived, not the stripped version. A
  // country code the customer wrote is information, and the person
  // ringing it will want to see what was actually said.
  const asGiven = args.newPhone.trim().slice(0, 40)

  await prisma.contactNote.create({
    data: {
      account_id: args.accountId,
      contact_id: from.id,
      user_id: owner,
      note_text:
        `Says they no longer hold the post at ${org}, and gave ${asGiven}` +
        (who ? ` for ${who}` : ' for whoever has taken over') +
        '.' +
        (said ? `\n\nTheir words: "${said}"` : '') +
        '\n\nNot yet confirmed — nobody has rung the new number, and this contact has not been changed.',
    },
  })

  await prisma.task.create({
    data: {
      account_id: args.accountId,
      user_id: owner,
      contact_id: from.id,
      title: `New contact for ${org}`,
      description:
        `${from.name?.trim() || from.phone} says they have handed over and gave ${asGiven}` +
        (who ? ` (${who})` : '') +
        '. Ring it to confirm before using it, then update the record. ' +
        'Nothing has been changed automatically — the number came from a message and may be incomplete.',
      // High, because the cost of ignoring it is a campaign that keeps
      // reaching somebody who has left.
      priority: 'high',
      assigned_to: args.userId ?? null,
    },
  })

  return {
    recorded: true,
    note:
      'Written down, and a colleague has been asked to ring the new number. Thank them for telling us and say somebody will contact the new person. ' +
      'Do NOT say our records have been updated — they have not been.',
  }
}

/** ContactNote and Task both require a user_id, and the account owner is
 *  the one user guaranteed to exist. */
async function anyOwnerOf(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { owner_user_id: true },
  })
  return account?.owner_user_id ?? null
}
