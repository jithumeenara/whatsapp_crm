/**
 * Record which account owns the files uploaded before per-account folders.
 *
 * ── Why ─────────────────────────────────────────────────────────────
 *
 * Old uploads sit at uploads/<name>, not uploads/account-<id>/<name>, so
 * nothing on disk says whose they are. Where the upload was recorded in
 * file_uploads, that row decides. Where it was not, the app serves the
 * file only while the server has exactly one business
 * (src/lib/files/legacy-access.ts, security review N4 / R4b). That works,
 * but the day a second business exists, every such file stops loading.
 *
 * On a server that has one business today, every unrecorded legacy file
 * can only be that business's. This writes that down — one file_uploads
 * row per unrecorded file, owned by that business — so afterwards the
 * file is decided by its row and the one-business exception is no longer
 * needed for it.
 *
 * ── What it does and does not do ────────────────────────────────────
 *
 *  - Dry run unless --apply is given.
 *  - Refuses to write anything unless exactly one business exists (same
 *    definition as the app: src/lib/files/business-filter.ts).
 *  - Never deletes, moves, renames or reads the contents of a file; it
 *    only lists names and sizes.
 *  - Safe to run twice: a file whose URL already has a row (any account)
 *    is skipped, so a second run records nothing.
 *  - Prints counts only — never file names or contents.
 *  - Skips the account-<id>/ folders (already owned by their folder),
 *    hidden files, symbolic links and anything that is not a plain file.
 *
 * Side effect to know about: recorded files appear in that business's
 * File Manager, like any other upload.
 *
 *   npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts           # report only
 *   npx tsx --env-file=.env scripts/backfill-legacy-file-owner.ts --apply   # write the rows
 *
 * Run from the app's directory (it reads ./uploads, as the app does).
 */

import { lstat, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { lookup } from 'mime-types'
import { BUSINESS_ACCOUNT_WHERE } from '../src/lib/files/business-filter'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const UPLOADS_DIR = join(process.cwd(), 'uploads')
const BATCH = 500

function categoryOf(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  return 'other'
}

interface Found {
  rel: string
  path: string
  size: number
}

/** Every plain, non-hidden file under uploads/, outside account-<id>/ folders. */
async function legacyFiles(dir: string, out: Found[], skipped: { count: number }): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    const rel = relative(UPLOADS_DIR, path)
    if (name.startsWith('.')) {
      skipped.count++
      continue
    }
    if (dir === UPLOADS_DIR && name.startsWith('account-')) continue
    const info = await lstat(path).catch(() => null)
    if (!info) continue
    if (info.isDirectory()) await legacyFiles(path, out, skipped)
    else if (info.isFile()) out.push({ rel, path, size: info.size })
    else skipped.count++ // symlinks, sockets, devices
  }
}

async function main() {
  console.log(APPLY ? 'APPLYING changes.\n' : 'Dry run — nothing will be written. Pass --apply to write.\n')

  const businesses = await prisma.account.findMany({ where: BUSINESS_ACCOUNT_WHERE, select: { id: true }, take: 2 })
  if (businesses.length !== 1) {
    console.log(
      businesses.length === 0
        ? 'No business with an active member was found. Nothing to do.'
        : 'This server has more than one business, so nobody can tell whose the unrecorded files are. Nothing was written.',
    )
    return
  }
  const accountId = businesses[0].id

  const found: Found[] = []
  const skipped = { count: 0 }
  await legacyFiles(UPLOADS_DIR, found, skipped)

  // URLs exactly as GET /api/files and media-ref.ts look them up.
  const withUrl = found.map((f) => ({ ...f, url: `/api/files/${f.rel.split(sep).join('/')}` }))
  const recorded = new Set<string>()
  for (let i = 0; i < withUrl.length; i += BATCH) {
    const rows = await prisma.fileUpload.findMany({
      where: { url: { in: withUrl.slice(i, i + BATCH).map((f) => f.url) } },
      select: { url: true },
    })
    for (const r of rows) recorded.add(r.url)
  }
  const todo = withUrl.filter((f) => !recorded.has(f.url))

  console.log(`Legacy files found:            ${found.length}`)
  console.log(`  already recorded (skipped):  ${found.length - todo.length}`)
  console.log(`  to record for the business:  ${todo.length}`)
  console.log(`Hidden files / links skipped:  ${skipped.count}`)

  if (!APPLY || todo.length === 0) return

  let written = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const res = await prisma.fileUpload.createMany({
      data: todo.slice(i, i + BATCH).map((f) => {
        const mime = lookup(f.path) || 'application/octet-stream'
        const name = f.rel.split(sep).pop() ?? f.rel
        return {
          account_id: accountId,
          original_name: name,
          stored_name: name,
          file_path: f.path,
          url: f.url,
          mime_type: mime,
          size: f.size,
          file_category: categoryOf(mime),
          // Never scanned; the same state a fresh File Manager upload starts in.
          scan_status: 'pending',
        }
      }),
    })
    written += res.count
  }
  console.log(`\nRecorded: ${written}`)
}

main()
  .catch((err: unknown) => {
    // The message only: a stack or query dump could carry paths or data.
    console.error('Backfill failed:', err instanceof Error ? err.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
