/**
 * Google Drive — a file the person picked, brought into the account's
 * files so it can be sent like any upload.
 *
 * Under drive.file the CRM can open only what was picked in the Picker;
 * the pick is the permission. Google's own documents have no bytes of
 * their own, so they are exported: Docs and Slides as PDF, Sheets as
 * Excel. Everything else is downloaded as it is, within the 16 MB every
 * upload route allows (rule 9), and only types the File Manager stores.
 */

import { contentMatchesType, isAllowedMime, saveAccountFile } from '@/lib/files/account-files'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'

const API = 'https://www.googleapis.com/drive/v3'
export const DRIVE_MAX_BYTES = 16 * 1024 * 1024

const EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
}

export class DriveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DriveError'
  }
}

/** What a Drive file will be stored as, or why it cannot be. */
export function driveTarget(meta: { name: string; mimeType: string; size?: string | number }): { mime: string; name: string; exported: boolean } | { error: string } {
  const exp = EXPORTS[meta.mimeType]
  if (exp) {
    const name = meta.name.toLowerCase().endsWith(exp.ext) ? meta.name : `${meta.name}${exp.ext}`
    return { mime: exp.mime, name, exported: true }
  }
  if (meta.mimeType.startsWith('application/vnd.google-apps.')) return { error: 'This kind of Google file cannot be attached. Choose a document, sheet, slides or an ordinary file.' }
  if (!isAllowedMime(meta.mimeType)) return { error: `“${meta.name}” is a type that cannot be sent. Images, videos, PDFs and Office documents can.` }
  if (Number(meta.size ?? 0) > DRIVE_MAX_BYTES) return { error: `“${meta.name}” is larger than 16 MB, which is the most that can be sent.` }
  return { mime: meta.mimeType, name: meta.name, exported: false }
}

async function driveFetch(token: string, path: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    throw new DriveError(`Could not reach Google Drive: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
  if (res.ok) return res
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Google Drive returned ${res.status}`
  if (/has not been used|is disabled/i.test(msg)) {
    throw new DriveError('The Google Drive API is not enabled in the Google Cloud project. APIs & Services → Library → Google Drive API → Enable.', 400)
  }
  if (res.status === 404) throw new DriveError('That file could not be opened. Choose it again in the Google window.', 404)
  if (/exportSizeLimitExceeded|too large/i.test(msg)) throw new DriveError('That Google file is too large to export.', 413)
  throw new DriveError(msg, res.status >= 400 && res.status < 500 ? res.status : 502)
}

export async function importDriveFile(accountId: string, fileId: string) {
  if (!(await isGoogleServiceEnabled(accountId, 'drive'))) throw new DriveError('Turn on Google Drive in Settings → Google first.', 400)
  if (!/^[\w-]{10,200}$/.test(fileId)) throw new DriveError('That is not a Drive file.', 400)
  const token = await googleAccessToken(accountId)
  const id = encodeURIComponent(fileId)
  const meta = (await (await driveFetch(token, `/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`)).json()) as {
    name: string
    mimeType: string
    size?: string
  }
  const target = driveTarget(meta)
  if ('error' in target) throw new DriveError(target.error, 400)

  const res = await driveFetch(
    token,
    target.exported
      ? `/files/${id}/export?mimeType=${encodeURIComponent(target.mime)}`
      : `/files/${id}?alt=media&supportsAllDrives=true`,
  )
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > DRIVE_MAX_BYTES) throw new DriveError(`“${target.name}” is larger than 16 MB, which is the most that can be sent.`, 413)
  if (!contentMatchesType(target.mime, bytes)) throw new DriveError(`“${target.name}” is not the kind of file its name says.`, 400)
  return saveAccountFile({ accountId, name: target.name, mime: target.mime, bytes })
}
