/**
 * The server-side database scripts (scripts/backup-db.sh, scripts/pg-env.sh).
 *
 * Run against stub pg_dump / pg_restore binaries that record what they
 * were given, so no database is needed. What matters here:
 *
 *   - the password never reaches a command line, where any user on the
 *     machine can read it from the process list (ps, /proc/<pid>/cmdline);
 *   - ?sslmode= in DATABASE_URL is honoured, not silently dropped — a
 *     remote database would otherwise be dumped over plain TCP;
 *   - the dump file is readable by its owner only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const REPO = resolve(__dirname, '../../..')
const PASSWORD = 's3cr@t:pa$$\\word'
// Percent-encoded as it would be in a real URL.
const ENCODED = encodeURIComponent(PASSWORD)

let dir: string

function stub(name: string, body: string) {
  const p = join(dir, 'bin', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crm-db-scripts-'))
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'bin'))
  for (const f of ['backup-db.sh', 'pg-env.sh']) copyFileSync(join(REPO, 'scripts', f), join(dir, 'scripts', f))
  // Records argv (one per line) and the connection env it was handed,
  // then writes a dump where --file= points.
  stub(
    'pg_dump',
    [
      `printf '%s\\n' "$@" > "${dir}/argv.log"`,
      `printf 'PGPASSWORD=%s\\nPGSSLMODE=%s\\nPGUSER=%s\\nPGHOST=%s\\nPGPORT=%s\\nPGDATABASE=%s\\n' "$PGPASSWORD" "\${PGSSLMODE:-}" "$PGUSER" "$PGHOST" "$PGPORT" "$PGDATABASE" > "${dir}/env.log"`,
      'for a in "$@"; do case $a in --file=*) echo dump > "${a#--file=}";; esac; done',
    ].join('\n'),
  )
  stub('pg_restore', 'exit 0')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function runBackup(url: string) {
  writeFileSync(join(dir, '.env'), `DATABASE_URL="${url}"\n`)
  return execFileSync('bash', [join(dir, 'scripts', 'backup-db.sh')], {
    cwd: dir,
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, BACKUP_DIR: join(dir, 'bk'), HOME: dir, NODE_ENV: 'test' },
    encoding: 'utf8',
  })
}

describe('scripts/backup-db.sh', () => {
  it('never puts the database password on pg_dump’s command line', () => {
    runBackup(`postgresql://crm:${ENCODED}@db.example.com:6543/crm_prod?schema=public`)
    const argv = readFileSync(join(dir, 'argv.log'), 'utf8')
    expect(argv).not.toContain(ENCODED)
    expect(argv).not.toContain('s3cr@t')
    expect(argv).not.toContain('postgresql://')
    const env = readFileSync(join(dir, 'env.log'), 'utf8')
    expect(env).toContain(`PGPASSWORD=${PASSWORD}\n`)
    expect(env).toContain('PGHOST=db.example.com\n')
    expect(env).toContain('PGPORT=6543\n')
    expect(env).toContain('PGDATABASE=crm_prod\n')
  })

  it('keeps ?sslmode= from DATABASE_URL', () => {
    runBackup(`postgresql://crm:${ENCODED}@db.example.com:5432/crm_prod?sslmode=verify-full&schema=public`)
    expect(readFileSync(join(dir, 'env.log'), 'utf8')).toContain('PGSSLMODE=verify-full\n')
  })

  it('does not print the password and writes an owner-only dump', () => {
    const out = runBackup(`postgresql://crm:${ENCODED}@db.example.com:5432/crm_prod`)
    expect(out).not.toContain('s3cr@t')
    const files = readdirSync(join(dir, 'bk'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^crm_prod-.*\.dump$/)
    expect(statSync(join(dir, 'bk', files[0])).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'bk')).mode & 0o777).toBe(0o700)
  })
})

describe('scripts/pg-env.sh', () => {
  function source(url: string) {
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${url}\n`)
    return execFileSync(
      'bash',
      ['-c', 'source scripts/pg-env.sh >/dev/null; printf "%s|%s|%s|%s|%s|%s" "$PGUSER" "$PGPASSWORD" "$PGHOST" "$PGPORT" "$PGDATABASE" "${PGSSLMODE:-}"'],
      { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, NODE_ENV: 'test' }, encoding: 'utf8' },
    )
  }

  it('decodes a password holding %, : , @ and a backslash exactly', () => {
    expect(source(`postgresql://crm:${ENCODED}@h:5432/db`)).toBe(`crm|${PASSWORD}|h|5432|db|`)
  })

  it('exports PGSSLMODE from the query string, and nothing else from it', () => {
    expect(source(`postgresql://crm:pw@h/db?schema=public&sslmode=require`)).toBe('crm|pw|h|5432|db|require')
  })

  it('ignores an sslmode value that is not one of libpq’s', () => {
    expect(source(`postgresql://crm:pw@h/db?sslmode=$(id)`)).toBe('crm|pw|h|5432|db|')
  })
})
