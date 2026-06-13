import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

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
  const candidates = [
    ...Array.from({ length: 7 }, (_, i) => `C:\\Program Files\\PostgreSQL\\${14 + i}\\bin\\${tool}.exe`),
    `/usr/lib/postgresql/15/bin/${tool}`,
    `/usr/lib/postgresql/16/bin/${tool}`,
    `/usr/local/bin/${tool}`,
    `/usr/bin/${tool}`,
    tool,
  ]
  return candidates.find((p) => p === tool || existsSync(p)) ?? tool
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only account owners can restore the DB
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_role: true },
  })
  if (!profile || profile.account_role !== 'owner') {
    return Response.json({ error: 'Only account owners can restore the database.' }, { status: 403 })
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return Response.json({ error: 'DATABASE_URL is not set' }, { status: 500 })
  }

  const db = parseDatabaseUrl(dbUrl)

  // Read the uploaded SQL from the request body
  let sqlText: string
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) return Response.json({ error: 'No file uploaded' }, { status: 400 })
      sqlText = await file.text()
    } else {
      sqlText = await request.text()
    }
  } catch {
    return Response.json({ error: 'Failed to read uploaded file' }, { status: 400 })
  }

  if (!sqlText.trim()) {
    return Response.json({ error: 'Uploaded file is empty' }, { status: 400 })
  }

  const args = [
    '-h', db.host,
    '-p', db.port,
    '-U', db.user,
    '--no-password',
    '-d', db.database,
    '-v',        // verbose — logs each statement
    '--single-transaction',  // wrap in a transaction so errors roll back
  ]

  return new Promise<Response>((resolve) => {
    const psql = spawn(findPgBin('psql'), args, {
      env: { ...process.env, PGPASSWORD: db.password },
    })

    let stderr = ''
    let stdout = ''

    psql.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    psql.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    psql.on('error', (err) => {
      resolve(Response.json(
        { error: `psql not found: ${err.message}. Make sure PostgreSQL client tools are installed.` },
        { status: 500 },
      ))
    })

    psql.stdin.write(sqlText, 'utf8')
    psql.stdin.end()

    psql.on('close', (code) => {
      if (code === 0) {
        resolve(Response.json({ ok: true, log: stdout.slice(-2000) }))
      } else {
        // Extract the first real error from stderr
        const errorLine = stderr
          .split('\n')
          .find((l) => l.toLowerCase().includes('error')) ?? stderr.slice(0, 500)
        resolve(Response.json(
          { error: errorLine || `psql exited with code ${code}`, log: stderr.slice(-2000) },
          { status: 500 },
        ))
      }
    })
  })
}
