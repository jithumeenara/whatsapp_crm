/**
 * What a private "check your details" link may reach. Everything a
 * stranger's request touches starts here: the signed link names one
 * verification and one row, and nothing else is ever read.
 */

import { prisma } from '@/lib/db'
import { personView, type RowDropdowns, type ViewItem } from './sheet-verify'
import { readLink } from './sheet-verify-link'
import { businessDate, businessName, findRow, isOpen, readSheet, rowDropdowns, setupOf, type Sheet, type Verification } from './sheet-verify-server'

export type LinkState =
  | { kind: 'invalid' }
  | { kind: 'closed'; business: string; lang: string; accountId: string; v: Verification }
  | { kind: 'not_found'; business: string; lang: string; accountId: string; v: Verification }
  | { kind: 'shared'; business: string; lang: string; accountId: string; v: Verification }
  | {
      kind: 'ok'
      v: Verification
      sheet: Sheet
      ref: string
      rowNumber: number
      row: string[]
      business: string
      lang: string
      deadline: string
      state: string
    }

/** The link, checked: signature, the verification, its key, its deadline, the row. */
export async function openLink(token: string, opts: { fresh?: boolean } = {}): Promise<LinkState> {
  const claim = readLink(token)
  if (!claim) return { kind: 'invalid' }
  const v = await prisma.sheetVerification.findUnique({ where: { id: claim.v } })
  // A link from before "cancel all links" looks like any wrong link.
  if (!v || v.key_version !== claim.k) return { kind: 'invalid' }
  const business = (await businessName(v.account_id)) || 'the organiser'
  if (!isOpen(v)) return { kind: 'closed', business, lang: v.language, accountId: v.account_id, v }
  const sheet = await readSheet(v, opts)
  const found = findRow(sheet, claim.r, setupOf(v))
  if (found.kind === 'none') return { kind: 'not_found', business, lang: v.language, accountId: v.account_id, v }
  // The same reference on two rows (a copied row): it could be either
  // person's link, so it opens neither until the business fixes the sheet.
  if (found.kind === 'many') return { kind: 'shared', business, lang: v.language, accountId: v.account_id, v }
  const person = await prisma.sheetVerificationPerson.findUnique({
    where: { verification_id_ref: { verification_id: v.id, ref: claim.r } },
    select: { state: true },
  })
  return {
    kind: 'ok',
    v,
    sheet,
    ref: claim.r,
    rowNumber: found.rowNumber,
    row: found.row,
    business,
    lang: v.language,
    deadline: await businessDate(v.account_id, v.deadline),
    state: person?.state ?? 'pending',
  }
}

export function viewOf(link: Extract<LinkState, { kind: 'ok' }>, dropdowns?: RowDropdowns): ViewItem[] {
  return personView(setupOf(link.v), link.sheet.headers, link.row, dropdowns)
}

/** The sheet's dropdown lists on this person's row. */
export function dropdownsOf(link: Extract<LinkState, { kind: 'ok' }>, opts: { fresh?: boolean } = {}): Promise<RowDropdowns> {
  return rowDropdowns(link.v, link.sheet, link.rowNumber, opts)
}
