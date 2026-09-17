import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * What is actually running, as opposed to what was pulled.
 *
 * This exists because of a failure that has now happened twice: `git
 * pull` followed by `pm2 restart`, with no `npm run build` in between.
 * Next serves the compiled output in `.next`, so the restart faithfully
 * relaunches the *old* code. Nothing anywhere says so — the commit is
 * new, the process is new, the behaviour is old — and the next hour goes
 * into debugging a bug that was fixed before the pull.
 *
 * So the one comparison that matters is made here and shown plainly:
 * the commit on disk against the time the build was made. If the commit
 * is newer than the build, the build is stale and nothing else in the
 * report can be trusted.
 *
 * Read at request time rather than baked in at build time, precisely so
 * a stale build cannot report itself as fresh.
 */

export const dynamic = 'force-dynamic'

interface GitInfo {
  commit: string | null
  subject: string | null
  committedAt: string | null
  branch: string | null
}

/**
 * The checked-out commit, read straight from `.git`.
 *
 * No shelling out to `git`: this runs inside a web request, and spawning
 * a process per request to read three small files is the wrong trade.
 * Returns nulls rather than throwing when `.git` is absent — a container
 * deploy legitimately has no repository, and that is worth reporting as
 * "unknown" instead of a 500.
 */
async function readGit(root: string): Promise<GitInfo> {
  const empty: GitInfo = { commit: null, subject: null, committedAt: null, branch: null }
  try {
    const head = (await readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim()

    let commit: string
    let branch: string | null = null
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim()
      branch = ref.replace(/^refs\/heads\//, '')
      try {
        commit = (await readFile(path.join(root, '.git', ref), 'utf8')).trim()
      } catch {
        // A packed ref — the loose file was garbage-collected away.
        const packed = await readFile(path.join(root, '.git', 'packed-refs'), 'utf8')
        const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`))
        if (!line) return { ...empty, branch }
        commit = line.split(' ')[0]
      }
    } else {
      // Detached HEAD holds the hash directly.
      commit = head
    }

    // The commit's own date and message live inside a zlib-compressed
    // object, which is more than this needs to justify. The mtime of the
    // ref is when this checkout moved to that commit, which is the more
    // useful number anyway: it is when the pull happened.
    let committedAt: string | null = null
    try {
      const refPath = head.startsWith('ref: ')
        ? path.join(root, '.git', head.slice(5).trim())
        : path.join(root, '.git', 'HEAD')
      committedAt = (await stat(refPath)).mtime.toISOString()
    } catch {
      /* leave null */
    }

    return { commit: commit.slice(0, 7), subject: null, committedAt, branch }
  } catch {
    return empty
  }
}

export async function GET() {
  try {
    await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  const root = process.cwd()

  let builtAt: string | null = null
  let buildId: string | null = null
  try {
    const idPath = path.join(root, '.next', 'BUILD_ID')
    buildId = (await readFile(idPath, 'utf8')).trim()
    builtAt = (await stat(idPath)).mtime.toISOString()
  } catch {
    // Dev mode has no BUILD_ID, which is a true and useful answer.
  }

  const git = await readGit(root)

  // The whole point of the endpoint. A build older than the checkout
  // means the running code is not the code on disk.
  const stale =
    Boolean(builtAt && git.committedAt) &&
    new Date(git.committedAt!).getTime() > new Date(builtAt!).getTime()

  return NextResponse.json({
    commit: git.commit,
    branch: git.branch,
    pulledAt: git.committedAt,
    builtAt,
    buildId,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    stale,
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
  })
}
