/**
 * The business's own details for the header of an exported report: name,
 * address, tax number, logo, brand colour and report language — always
 * from the signed-in session's own account, never from a request.
 */

import { prisma } from '@/lib/db'
import { readAccountFile } from '@/lib/files/account-files'
import { imageProblem } from '@/lib/files/image-size'
import { isValidReportLanguage } from '@/lib/countries'
import { parsePresentationSettings } from '../settings'
import type { DocBusiness } from './types'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

export async function loadDocBusiness(accountId: string): Promise<{ business: DocBusiness; language: string }> {
  const [account, company, extra, settings] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
    prisma.companyProfile.findUnique({ where: { account_id: accountId } }),
    prisma.accountReportProfile.findUnique({ where: { account_id: accountId } }).catch(() => null),
    prisma.leadSettings.findUnique({ where: { account_id: accountId }, select: { report_settings: true } }),
  ])

  let logo: DocBusiness['logo'] = null
  if (extra?.logo_file_id) {
    const file = await readAccountFile(accountId, extra.logo_file_id, MAX_LOGO_BYTES).catch(() => null)
    if (file && (file.mime === 'image/png' || file.mime === 'image/jpeg') && !imageProblem(file.mime, file.bytes)) {
      logo = { bytes: file.bytes, mime: file.mime }
    }
  }
  const place = [company?.address, company?.city, company?.state, company?.country].filter(Boolean).join(', ')
  const contact = [company?.phone, company?.email].filter(Boolean).join(' · ')
  return {
    business: {
      name: company?.display_name || company?.legal_name || account?.name || '',
      lines: [place, contact].filter(Boolean),
      taxId: extra?.tax_id ?? null,
      logo,
      brandColor: parsePresentationSettings(settings?.report_settings).brandColor,
    },
    language: isValidReportLanguage(extra?.report_language) ? extra.report_language : 'en',
  }
}
