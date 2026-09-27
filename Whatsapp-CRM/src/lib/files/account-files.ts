/**
 * An account's stored files: the one list of what may be kept, and the
 * one way to write or read one.
 *
 * Every read is by file id *and* account, so a file id from another
 * account finds nothing. Paths are never taken from input.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'

export const UPLOADS_DIR = join(process.cwd(), 'uploads')

/** What may be stored, by MIME type. SVG is left out on purpose: it can
 *  carry script. Executables and archives are left out: nobody needs to
 *  open one from a customer's email inside a CRM. */
export const MIME_CATEGORY: Record<string, string> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'video/quicktime': 'video',
  'application/pdf': 'pdf',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
}

export function isAllowedMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_CATEGORY, mime)
}

/**
 * Whether the bytes are what the declared type says. A sender chooses the
 * type an attachment claims to be; the first bytes of the file are much
 * harder to lie about. An executable renamed "invoice.pdf" and labelled
 * application/pdf fails here.
 */
export function contentMatchesType(mime: string, bytes: Buffer): boolean {
  const head = bytes.subarray(0, 16)
  const starts = (sig: number[], at = 0) => sig.every((b, i) => head[at + i] === b)
  switch (mime) {
    case 'application/pdf':
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47])
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff])
    case 'image/gif':
      return starts([0x47, 0x49, 0x46, 0x38]) // GIF8
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8) // RIFF….WEBP
    case 'video/mp4':
    case 'video/3gpp':
    case 'video/quicktime':
      return starts([0x66, 0x74, 0x79, 0x70], 4) || starts([0x6d, 0x6f, 0x6f, 0x76], 4) // ftyp / moov
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return starts([0x50, 0x4b, 0x03, 0x04]) // zip container
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return starts([0xd0, 0xcf, 0x11, 0xe0]) // OLE compound file
    case 'text/plain':
    case 'text/csv':
      return !bytes.subarray(0, 4096).includes(0) // text has no NUL bytes
    default:
      return false
  }
}

/** Writes bytes as a new file of this account, and asks the virus scanner
 *  (when one is configured) to look at it. */
export async function saveAccountFile(args: {
  accountId: string
  name: string
  mime: string
  bytes: Buffer
}) {
  if (!isAllowedMime(args.mime)) throw new Error('File type not allowed')
  const dir = join(UPLOADS_DIR, `account-${args.accountId}`)
  await mkdir(dir, { recursive: true })
  const ext = extname(args.name).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)
  const safe = basename(args.name, extname(args.name)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'file'
  const storedName = `${randomUUID()}-${safe}${ext}`
  const filePath = join(dir, storedName)
  await writeFile(filePath, args.bytes)
  const url = `/api/files/account-${args.accountId}/${storedName}`
  const record = await prisma.fileUpload.create({
    data: {
      account_id: args.accountId,
      original_name: args.name.slice(0, 200),
      stored_name: storedName,
      file_path: filePath,
      url,
      mime_type: args.mime,
      size: args.bytes.length,
      file_category: MIME_CATEGORY[args.mime] ?? 'other',
      scan_status: 'pending',
    },
  })
  const scanUrl = process.env.VIRUS_SCAN_WEBHOOK_URL
  if (scanUrl) {
    fetch(scanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: record.id,
        url,
        original_name: record.original_name,
        mime_type: args.mime,
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/file-manager/${record.id}/scan-result`,
      }),
    }).catch(() => {})
  }
  return record
}

/** Reads one of this account's files. Null when the id is not theirs, the
 *  file is too big, or the scanner flagged it. */
export async function readAccountFile(accountId: string, fileId: string, maxBytes: number) {
  const row = await prisma.fileUpload.findFirst({ where: { id: fileId, account_id: accountId } })
  if (!row || row.size > maxBytes || row.scan_status === 'infected') return null
  if (!isAllowedMime(row.mime_type)) return null
  // The stored path, but only inside this account's own folder.
  const expectedDir = join(UPLOADS_DIR, `account-${accountId}`)
  if (!row.file_path.startsWith(expectedDir)) return null
  const bytes = await readFile(row.file_path)
  return { id: row.id, name: row.original_name, mime: row.mime_type, size: row.size, url: row.url, bytes }
}
