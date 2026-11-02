/**
 * Files the crm-audit user keeps in its state folder (0700): progress of
 * the signer and the uploader, the local copy of every signed checkpoint
 * (checkpoints.ndjson) and the alarm throttle. Written atomically
 * (temp file + rename), owner-only.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { newestByAccount, parseCheckpoint, verifyCheckpoint, type Checkpoint } from '../../../src/lib/audit/offsite/checkpoint'

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`could not read ${file}: ${err instanceof Error ? err.message : err}`)
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

export function appendLine(file: string, line: string): void {
  ensureDir(path.dirname(file))
  const fd = fs.openSync(file, 'a', 0o600)
  try {
    fs.writeSync(fd, line.replace(/\n/g, ' ') + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

export const checkpointsFile = (stateDir: string) => path.join(stateDir, 'checkpoints.ndjson')

/** Every checkpoint in the local file whose signature holds; bad lines are reported. */
export function readLocalCheckpoints(stateDir: string, publicKey: crypto.KeyObject): { list: Checkpoint[]; bad: number } {
  let text = ''
  try {
    text = fs.readFileSync(checkpointsFile(stateDir), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { list: [], bad: 0 }
    throw err
  }
  const list: Checkpoint[] = []
  let bad = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let cp: Checkpoint | null = null
    try {
      cp = parseCheckpoint(JSON.parse(line))
    } catch {
      cp = null
    }
    if (cp && verifyCheckpoint(cp, publicKey)) list.push(cp)
    else bad++
  }
  return { list, bad }
}

export function newestLocal(stateDir: string, publicKey: crypto.KeyObject): Map<string, Checkpoint> {
  return newestByAccount(readLocalCheckpoints(stateDir, publicKey).list)
}

/** The private key (only crm-audit can read it) and its public half. */
export function loadKeys(file: string): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  const privateKey = crypto.createPrivateKey(fs.readFileSync(file))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('signing key must be Ed25519 (openssl genpkey -algorithm ed25519)')
  return { privateKey, publicKey: crypto.createPublicKey(privateKey) }
}
