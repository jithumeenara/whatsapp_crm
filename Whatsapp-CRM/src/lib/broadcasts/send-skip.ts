/**
 * Who is left out at the moment of sending, although they were in the
 * audience when the broadcast was set up.
 *
 * Recipients are fixed when a broadcast is created, and a scheduled one or
 * a follow-up can go out days later. By then a person may have opted out,
 * been blocked or merged into another contact — or, for a follow-up, have
 * answered the first message, so a "you haven't replied" reminder would be
 * wrong and annoying. They are marked 'skipped' with this reason instead of
 * being sent to.
 */

import { isSendableContact, type SendableFields } from './sendable'

export interface SkipInput {
  contact: SendableFields | null
  /** This broadcast is a follow-up, and the person has since replied to the
   *  broadcast it follows up. */
  repliedToParent: boolean
  /** The group of the parent this follow-up went to ('replied', …), or null. */
  parentOutcome: string | null
}

export function skipReason({ contact, repliedToParent, parentOutcome }: SkipInput): string | null {
  // No contact or no number is a failure of the data, handled by the
  // send loop's own "No phone number" check.
  if (!contact?.phone) return null
  if (contact.opt_in_status === 'opted_out') return 'Left out: asked for no more messages'
  if (contact.blocked_at) return 'Left out: contact is blocked'
  if (contact.merged_into_contact_id) return 'Left out: merged into another contact'
  if (!isSendableContact(contact)) return null
  // A follow-up written for people who replied is meant for them.
  if (repliedToParent && parentOutcome !== 'replied') return 'Left out: replied to the first message'
  return null
}
