import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { auth } from '@/auth'
import { isPlatformOwner } from '@/lib/auth/platform-owner'

function parseDatabaseUrl(url: string) {
  const u = new URL(url.replace(/^postgres:\/\//, 'postgresql://'))
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  }
}

function findPgBin(tool: string): string {
  // Check well-known install locations on Windows and Linux
  const candidates = [
    // Windows — PostgreSQL versions 14–20
    ...Array.from({ length: 7 }, (_, i) => `C:\\Program Files\\PostgreSQL\\${14 + i}\\bin\\${tool}.exe`),
    // Linux / macOS (when not in PATH)
    `/usr/lib/postgresql/15/bin/${tool}`,
    `/usr/lib/postgresql/16/bin/${tool}`,
    `/usr/local/bin/${tool}`,
    `/usr/bin/${tool}`,
    tool, // rely on PATH as last resort
  ]
  return candidates.find((p) => p === tool || existsSync(p)) ?? tool
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // The whole database — every workspace on this server — so the server's
  // owner only, never any workspace's owner or admin (platform-owner.ts).
  if (!(await isPlatformOwner(session.user.id))) {
    return new Response(JSON.stringify({ error: 'Only the owner of this server can download a backup of the whole database.' }), { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: 'DATABASE_URL is not set' }), { status: 500 })
  }

  const db = parseDatabaseUrl(dbUrl)

  const args = [
    '-h', db.host,
    '-p', db.port,
    '-U', db.user,
    '--no-password',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '-F', 'p',  // plain SQL — human-readable, restores with psql
    db.database,
  ]

  const pgDump = spawn(findPgBin('pg_dump'), args, {
    env: { ...process.env, PGPASSWORD: db.password },
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      pgDump.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      pgDump.stdout.on('end', () => {
        controller.close()
      })
      pgDump.stderr.on('data', (chunk: Buffer) => {
        console.error('[pg_dump stderr]', chunk.toString())
      })
      pgDump.on('error', (err) => {
        console.error('[pg_dump error]', err)
        controller.error(err)
      })
    },
    cancel() {
      pgDump.kill()
    },
  })

  const filename = `crm-db-backup-${new Date().toISOString().slice(0, 10)}.sql`

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/sql',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Transfer-Encoding': 'chunked',
    },
  })
}
