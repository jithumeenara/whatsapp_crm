import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/files/... — one account's files are that account's.
 *
 * The folder check looked only at the first path segment, and the
 * traversal check only that the result stayed inside uploads/. Together
 * they let `account-<mine>/../account-<theirs>/<file>` (or any legacy
 * first segment followed by `..`) read another workspace's file — an ID
 * card, an invoice — by name.
 */

const h = vi.hoisted(() => ({ root: '' }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' } }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: () => Promise.resolve({ account_id: 'mine' }) },
    fileUpload: {
      findFirst: (a: { where: { url?: string } }) =>
        Promise.resolve(a.where.url === '/api/files/legacy-theirs.pdf' ? { account_id: 'theirs' } : null),
    },
  },
}))

beforeAll(() => {
  h.root = mkdtempSync(join(tmpdir(), 'files-route-'))
  mkdirSync(join(h.root, 'uploads', 'account-mine'), { recursive: true })
  mkdirSync(join(h.root, 'uploads', 'account-theirs'), { recursive: true })
  writeFileSync(join(h.root, 'uploads', 'account-mine', 'a.pdf'), '%PDF-1.4 mine')
  writeFileSync(join(h.root, 'uploads', 'account-theirs', 'secret.pdf'), '%PDF-1.4 theirs')
  writeFileSync(join(h.root, 'uploads', 'legacy-theirs.pdf'), '%PDF-1.4 legacy theirs')
  writeFileSync(join(h.root, 'uploads', 'account-mine', 'page".html'), '<script>x</script>')
  vi.spyOn(process, 'cwd').mockReturnValue(h.root)
})

const get = async (...path: string[]) => {
  const { GET } = await import('./route')
  return GET(new Request('http://x') as never, { params: Promise.resolve({ path }) })
}

describe('GET /api/files', () => {
  it('serves the caller’s own file', async () => {
    const res = await get('account-mine', 'a.pdf')
    expect(res.status).toBe(200)
  })

  it('does not climb out of the caller’s folder into another account’s', async () => {
    expect((await get('account-mine', '..', 'account-theirs', 'secret.pdf')).status).toBe(404)
    expect((await get('anything', '..', 'account-theirs', 'secret.pdf')).status).toBe(404)
    expect((await get('account-theirs', 'secret.pdf')).status).toBe(404)
  })

  it('a legacy file recorded as another account’s is not served', async () => {
    expect((await get('legacy-theirs.pdf')).status).toBe(404)
  })

  it('a download’s name cannot break out of the header, and never renders', async () => {
    const res = await get('account-mine', 'page".html')
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[^"]*"$/)
    expect(res.headers.get('content-security-policy')).toBe('sandbox')
  })
})
