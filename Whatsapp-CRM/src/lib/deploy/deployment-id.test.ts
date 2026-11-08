import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deploymentIdFor, ID_FILE, readGitCommit } from './deployment-id'

const SHA = 'a'.repeat(8) + 'b'.repeat(32)

let root = ''
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpl-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

/** Repo at root/, app in root/app (like this project: the app is one level down). */
function repo(head: string, refs: Record<string, string> = {}, packed = '') {
  const git = path.join(root, '.git')
  fs.mkdirSync(git, { recursive: true })
  fs.writeFileSync(path.join(git, 'HEAD'), `${head}\n`)
  for (const [ref, sha] of Object.entries(refs)) {
    fs.mkdirSync(path.dirname(path.join(git, ref)), { recursive: true })
    fs.writeFileSync(path.join(git, ref), `${sha}\n`)
  }
  if (packed) fs.writeFileSync(path.join(git, 'packed-refs'), packed)
  const app = path.join(root, 'app')
  fs.mkdirSync(app)
  return app
}

describe('readGitCommit', () => {
  it('follows HEAD to the branch ref, from the app folder one level down', () => {
    expect(readGitCommit(repo('ref: refs/heads/master', { 'refs/heads/master': SHA }))).toBe(SHA)
  })

  it('reads a packed ref and a detached HEAD', () => {
    expect(readGitCommit(repo('ref: refs/heads/master', {}, `# pack-refs\n${SHA} refs/heads/master\n`))).toBe(SHA)
    fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root)
    expect(readGitCommit(repo(SHA))).toBe(SHA)
  })

  it('reads a worktree, whose .git is a file pointing elsewhere', () => {
    const app = repo('ref: refs/heads/master', { 'refs/heads/master': SHA })
    const wtGit = path.join(root, '.git', 'worktrees', 'wt')
    fs.mkdirSync(wtGit, { recursive: true })
    fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/master\n')
    fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n')
    const wt = path.join(root, 'wt')
    fs.mkdirSync(path.join(wt, 'app'), { recursive: true })
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`)
    expect(readGitCommit(path.join(wt, 'app'))).toBe(SHA)
    expect(app).toBeTruthy()
  })

  it('gives null without a repository instead of throwing', () => {
    expect(readGitCommit(path.join(root, 'nowhere'))).toBeNull()
  })
})

describe('deploymentIdFor', () => {
  it('the build makes the id and the server reads back the very same id', () => {
    const app = repo('ref: refs/heads/master', { 'refs/heads/master': SHA })
    const built = deploymentIdFor('phase-production-build', app)
    expect(built).toBe(SHA.slice(0, 12))
    expect(deploymentIdFor('phase-production-server', app)).toBe(built)
  })

  it('a pull without a rebuild does not change the running id (no reload loop)', () => {
    const app = repo('ref: refs/heads/master', { 'refs/heads/master': SHA })
    deploymentIdFor('phase-production-build', app)
    fs.writeFileSync(path.join(root, '.git', 'refs/heads/master'), `${'c'.repeat(40)}\n`)
    expect(deploymentIdFor('phase-production-server', app)).toBe(SHA.slice(0, 12))
  })

  it('no id in development, or when the build had no git', () => {
    const app = path.join(root, 'app')
    fs.mkdirSync(app)
    expect(deploymentIdFor('phase-development-server', app)).toBeUndefined()
    expect(deploymentIdFor('phase-production-build', app)).toBeUndefined()
    expect(fs.existsSync(path.join(app, ID_FILE))).toBe(false)
    expect(deploymentIdFor('phase-production-server', app)).toBeUndefined()
  })

  it('ignores a tampered id file', () => {
    const app = path.join(root, 'app')
    fs.mkdirSync(app)
    fs.writeFileSync(path.join(app, ID_FILE), '"><script>\n')
    expect(deploymentIdFor('phase-production-server', app)).toBeUndefined()
  })
})
