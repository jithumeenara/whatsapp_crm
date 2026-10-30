import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { auth } from '@/auth'
import { isPlatformOwner } from '@/lib/auth/platform-owner'

/** sslmode values libpq understands; anything else is dropped, not passed on. */
const SSL_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])

function parseDatabaseUrl(url: string) {
  const u = new URL(url.replace(/^postgres:\/\//, 'postgresql://'))
  const sslmode = u.searchParams.get('sslmode')
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    sslmode: sslmode && SSL_MODES.has(sslmode) ? sslmode : null,
  }
}

/**
 * What pg_dump is given to run with: the connection settings and enough
 * to find its libraries. Not the server's environment — that holds
 * AUTH_SECRET, ENCRYPTION_KEY and every provider key, none of which a
 * child process has any use for.
 */
function pgDumpEnv(db: ReturnType<typeof parseDatabaseUrl>): NodeJS.ProcessEnv {
  // NODE_ENV only because the type insists; pg_dump ignores it.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, PGPASSWORD: db.password }
  if (db.sslmode) env.PGSSLMODE = db.sslmode
  for (const k of ['PATH', 'SYSTEMROOT', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'LANG', 'LC_ALL']) {
    const v = process.env[k]
    if (v) env[k] = v
  }
  return env
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

  console.info(`[database/backup] whole-database backup started by user ${session.user.id} at ${new Date().toISOString()}`)

  const pgDump = spawn(findPgBin('pg_dump'), args, { env: pgDumpEnv(db) })

  // Nothing is sent until pg_dump has either produced its first output
  // or stopped: a dump that fails at the start (wrong password, host
  // unreachable) is a 500 with a plain message, not a 200 with an empty
  // file somebody later finds restores nothing. A failure part-way
  // through errors the stream, so the browser reports the download as
  // failed instead of saving a truncated file.
  let exitCode: number | null = null
  const exited = new Promise<number>((resolve) => {
    pgDump.on('close', (code: number | null) => {
      exitCode = code ?? 1
      resolve(exitCode)
    })
    pgDump.on('error', (err: Error) => {
      console.error('[pg_dump error]', err)
      exitCode = 1
      resolve(1)
    })
  })
  pgDump.stderr.on('data', (chunk: Buffer) => {
    console.error('[pg_dump stderr]', chunk.toString())
  })

  const pending: Buffer[] = []
  let ended = false
  const firstOutput = new Promise<void>((resolve) => {
    pgDump.stdout.once('data', () => resolve())
    pgDump.stdout.once('end', () => resolve())
  })
  pgDump.stdout.on('data', (chunk: Buffer) => pending.push(chunk))
  pgDump.stdout.on('end', () => { ended = true })
  await Promise.race([firstOutput, exited])
  if (ended) await exited
  if (exitCode !== null && exitCode !== 0) {
    console.error(`[database/backup] pg_dump exited with code ${exitCode}`)
    return new Response(JSON.stringify({ error: 'The backup could not be made. The server log has the reason.' }), { status: 500 })
  }
  pgDump.stdout.removeAllListeners('data')
  pgDump.stdout.removeAllListeners('end')

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of pending) controller.enqueue(new Uint8Array(chunk))
      pgDump.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      exited.then((code) => {
        if (code === 0) {
          console.info('[database/backup] finished')
          controller.close()
        } else {
          console.error(`[database/backup] pg_dump exited with code ${code} part-way through`)
          controller.error(new Error('pg_dump failed'))
        }
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
