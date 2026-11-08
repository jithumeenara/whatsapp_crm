/**
 * The deployment id Next.js uses for version-skew protection
 * (next.config `deploymentId`; node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/deploymentId.md).
 *
 * Why: after a server update, a tab opened before it kept asking for the
 * old build's JavaScript, which no longer exists, and showed a blank page
 * (seen on a live server's login page). With a deployment id, Next sees
 * the mismatch on the next navigation and does a full reload instead.
 *
 * The id must be the same at build time and when the server runs, or
 * every navigation would reload. So it is made once, during the build,
 * from the checked-out commit, written to `.deployment-id`, and the server
 * reads that file back. No git at build time, or no file at run time,
 * means no id: Next then behaves exactly as before. Never throws.
 */

import fs from 'node:fs'
import path from 'node:path'

export const ID_FILE = '.deployment-id'

/** The checked-out commit, read from .git (plain repo or worktree); null when unknown. */
export function readGitCommit(appRoot: string): string | null {
  try {
    let dotGit = ''
    for (const dir of [appRoot, path.dirname(appRoot)]) {
      const p = path.join(dir, '.git')
      if (fs.existsSync(p)) { dotGit = p; break }
    }
    if (!dotGit) return null
    let gitDir = dotGit
    if (fs.statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'))
      if (!m) return null
      gitDir = path.resolve(path.dirname(dotGit), m[1].trim())
    }
    const commonFile = path.join(gitDir, 'commondir')
    const commonDir = fs.existsSync(commonFile) ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()) : gitDir
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    if (/^[0-9a-f]{40}$/.test(head)) return head
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1]
    if (!ref || ref.includes('..')) return null
    for (const dir of [gitDir, commonDir]) {
      const p = path.join(dir, ref)
      if (fs.existsSync(p)) {
        const sha = fs.readFileSync(p, 'utf8').trim()
        if (/^[0-9a-f]{40}$/.test(sha)) return sha
      }
    }
    const packed = path.join(commonDir, 'packed-refs')
    if (fs.existsSync(packed)) {
      const line = fs.readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`))
      const sha = line?.split(' ')[0]
      if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha
    }
    return null
  } catch {
    return null
  }
}

/** For next.config: made and saved during a production build, read back when the server runs. */
export function deploymentIdFor(phase: string, appRoot: string): string | undefined {
  const file = path.join(appRoot, ID_FILE)
  try {
    if (phase === 'phase-production-build') {
      const commit = readGitCommit(appRoot)
      if (!commit) {
        fs.rmSync(file, { force: true })
        return undefined
      }
      const id = commit.slice(0, 12)
      fs.writeFileSync(file, `${id}\n`)
      return id
    }
    if (phase === 'phase-production-server') {
      const id = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
      return /^[0-9a-f]{12}$/.test(id) ? id : undefined
    }
  } catch {
    // Never let this stop a build or a start.
  }
  return undefined
}
