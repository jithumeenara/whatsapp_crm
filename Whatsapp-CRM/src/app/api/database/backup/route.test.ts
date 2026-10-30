import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A4-02 / A4-06: the backup download.
 *  - pg_dump failing (bad password, unreachable host) still answered 200
 *    with an empty or cut-off .sql file — a "backup" that restores nothing.
 *  - pg_dump was handed the whole server environment (AUTH_SECRET,
 *    ENCRYPTION_KEY, provider keys) when it needs only PG* and PATH.
 *  - ?sslmode= on DATABASE_URL was ignored, so a managed database that
 *    requires TLS was dumped over plain TCP or not at all.
 */

const h = vi.hoisted(() => ({
  owner: true,
  exitCode: 0,
  output: 'SELECT 1;\n',
  spawned: [] as { cmd: string; args: string[]; env: Record<string, string | undefined> }[],
}))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: () => Promise.resolve(h.owner) }))
vi.mock('child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { env: Record<string, string | undefined> }) => {
    h.spawned.push({ cmd, args, env: opts.env })
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} })
    setTimeout(() => {
      if (h.exitCode === 0) proc.stdout.write(h.output)
      proc.stdout.end()
      proc.stderr.end()
      proc.emit('close', h.exitCode)
      proc.emit('exit', h.exitCode)
    }, 5)
    return proc
  },
}))

import { GET } from './route'

const saved = { ...process.env }
beforeEach(() => {
  h.owner = true
  h.exitCode = 0
  h.spawned = []
  process.env.DATABASE_URL = 'postgresql://crm:p%40ss@db.example.com:6543/crm?sslmode=require'
  process.env.AUTH_SECRET = 'must-not-reach-pg_dump'
})
afterEach(() => {
  process.env = { ...saved }
})

describe('GET /api/database/backup', () => {
  it('only the server owner', async () => {
    h.owner = false
    expect((await GET()).status).toBe(403)
    expect(h.spawned).toEqual([])
  })

  it('a failed pg_dump is an error, not an empty backup', async () => {
    h.exitCode = 1
    const res = await GET()
    expect(res.status).toBe(500)
  })

  it('pg_dump gets the PG settings it needs and nothing else', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('SELECT 1;\n')
    const env = h.spawned[0].env
    expect(env.PGPASSWORD).toBe('p@ss')
    expect(env.PGSSLMODE).toBe('require')
    expect(env.AUTH_SECRET).toBeUndefined()
  })

  it('an sslmode libpq does not know is not passed through', async () => {
    process.env.DATABASE_URL = 'postgresql://crm:x@db/crm?sslmode=;rm%20-rf'
    await GET()
    expect(h.spawned[0].env.PGSSLMODE).toBeUndefined()
  })
})
