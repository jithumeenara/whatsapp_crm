import zlib from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * The business logo shown at the top of report PDFs.
 *
 * An upload is the riskiest thing a settings page takes, so the rules here
 * are strict: admins only; PNG or JPEG only (the PDF writer takes nothing
 * else, and SVG can carry script); the real type is read from the bytes, not
 * from what the sender claims; a size cap and a pixel cap so a crafted image
 * cannot exhaust the server when the PDF is built; stored under a random name;
 * and only ever read back from the business's own folder.
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  saved: [] as Array<{ accountId: string; name: string; mime: string; size: number }>,
  upserts: [] as Array<Record<string, any>>,
  cleared: 0,
  profile: null as null | { logo_file_id: string | null },
  readCalls: [] as Array<{ accountId: string; fileId: string }>,
  stored: null as null | { mime: string; bytes: Buffer },
  userId: 'u1',
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  return {
    ForbiddenError,
    requireRole: (min: string) => {
      if ((rank[h.role] ?? 0) < (rank[min] ?? 99)) throw new ForbiddenError('no')
      return Promise.resolve({ userId: h.userId, accountId: 'acc-1', role: h.role })
    },
    toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: () => Promise.resolve() }))
vi.mock('@/lib/files/account-files', async () => {
  const actual = await vi.importActual<typeof import('@/lib/files/account-files')>('@/lib/files/account-files')
  return {
    ...actual,
    saveAccountFile: (a: { accountId: string; name: string; mime: string; bytes: Buffer }) => {
      h.saved.push({ accountId: a.accountId, name: a.name, mime: a.mime, size: a.bytes.length })
      return Promise.resolve({ id: 'file-new' })
    },
    readAccountFile: (accountId: string, fileId: string) => {
      h.readCalls.push({ accountId, fileId })
      return Promise.resolve(h.stored ? { id: fileId, ...h.stored, name: 'logo', size: h.stored.bytes.length, url: '' } : null)
    },
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    accountReportProfile: {
      findUnique: () => Promise.resolve(h.profile),
      upsert: ({ update }: any) => {
        h.upserts.push(update)
        return Promise.resolve({})
      },
      updateMany: () => {
        h.cleared += 1
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { GET, POST, DELETE } from './route'

/** A PNG chunk with a real CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const b of body) {
    crc ^= b
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  const out = Buffer.alloc(4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, body, out])
}

/** A real, decodable w x h RGBA PNG; `trailing` bytes are appended after its end. */
function png(w = 200, hgt = 80, trailing = 0, idat?: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(hgt, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const data = idat ?? zlib.deflateSync(Buffer.alloc((w * 4 + 1) * Math.min(hgt, 4000)))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0)),
    Buffer.alloc(trailing),
  ])
}

const upload = (bytes: Buffer | string, type: string, name = 'logo.png') => {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], name, { type }))
  return POST(new Request('http://x/api/business-profile/logo', { method: 'POST', body: form }))
}

beforeEach(() => {
  h.role = 'admin'
  h.saved = []
  h.upserts = []
  h.cleared = 0
  h.profile = null
  h.readCalls = []
  h.stored = null
  h.userId = `u-${Math.random()}`
})

describe('POST /api/business-profile/logo', () => {
  it('is for admins only', async () => {
    h.role = 'supervisor'
    expect((await upload(png(), 'image/png')).status).toBe(403)
    expect(h.saved).toHaveLength(0)
  })

  it('stores a real PNG and points the profile at it', async () => {
    const res = await upload(png(), 'image/png')
    expect(res.status).toBe(200)
    expect(h.saved).toEqual([expect.objectContaining({ accountId: 'acc-1', mime: 'image/png' })])
    expect(h.upserts[0]).toMatchObject({ logo_file_id: 'file-new' })
  })

  it('refuses SVG, even when it claims to be a PNG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    expect((await upload(svg, 'image/svg+xml', 'logo.svg')).status).toBe(400)
    expect((await upload(svg, 'image/png')).status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('refuses a type the PDF cannot use (WebP, GIF, PDF)', async () => {
    for (const type of ['image/webp', 'image/gif', 'application/pdf']) {
      expect((await upload(png(), type)).status).toBe(400)
    }
    expect(h.saved).toHaveLength(0)
  })

  it('refuses a file whose bytes are not the type it claims', async () => {
    expect((await upload(Buffer.from('MZ not an image at all, just a program'), 'image/png')).status).toBe(400)
    expect((await upload(Buffer.from('plain text pretending'), 'image/jpeg', 'x.jpg')).status).toBe(400)
  })

  it('refuses a file over 2 MB, with a clear message', async () => {
    const res = await upload(png(200, 80, 2 * 1024 * 1024), 'image/png')
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/2 MB/)
    expect(h.saved).toHaveLength(0)
  })

  it('refuses an image with absurd dimensions, which could exhaust the PDF writer', async () => {
    expect((await upload(png(20000, 20000, 0, zlib.deflateSync(Buffer.alloc(10))), 'image/png')).status).toBe(400)
    expect((await upload(png(0, 0, 0, zlib.deflateSync(Buffer.alloc(10))), 'image/png')).status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('refuses a PNG whose header is fine and whose data is corrupt: it would crash the PDF writer later', async () => {
    const res = await upload(png(10, 10, 0, Buffer.from('this is not zlib data at all')), 'image/png')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/damaged/i)
    expect(h.saved).toHaveLength(0)
  })

  it('refuses a small file that claims to be a huge picture (a decompression bomb)', async () => {
    const bomb = png(2000, 2000, 0, zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024)))
    expect(bomb.length).toBeLessThan(100 * 1024)
    expect((await upload(bomb, 'image/png')).status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('needs a file', async () => {
    const res = await POST(new Request('http://x/api/business-profile/logo', { method: 'POST', body: new FormData() }))
    expect(res.status).toBe(400)
  })

  it('turns away the eleventh upload in a minute from one person', async () => {
    let last = 200
    for (let i = 0; i < 11; i++) last = (await upload(png(), 'image/png')).status
    expect(last).toBe(429)
  })
})

describe('GET /api/business-profile/logo', () => {
  it('serves the logo to a signed-in member with hardening headers, read from the business\'s own folder', async () => {
    h.role = 'viewer'
    h.profile = { logo_file_id: 'file-1' }
    h.stored = { mime: 'image/png', bytes: png() }
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(res.headers.get('cache-control')).toMatch(/private/)
    expect(h.readCalls).toEqual([{ accountId: 'acc-1', fileId: 'file-1' }])
  })

  it('is a plain 404 when there is no logo, or the file is gone, or it is not an image', async () => {
    h.role = 'viewer'
    expect((await GET()).status).toBe(404)
    h.profile = { logo_file_id: 'file-1' }
    expect((await GET()).status).toBe(404)
    h.stored = { mime: 'image/png', bytes: Buffer.from('<svg onload=alert(1)>') }
    expect((await GET()).status).toBe(404)
  })
})

describe('DELETE /api/business-profile/logo', () => {
  it('clears the logo for an admin and refuses everyone else', async () => {
    h.role = 'agent'
    expect((await DELETE()).status).toBe(403)
    expect(h.cleared).toBe(0)
    h.role = 'admin'
    expect((await DELETE()).status).toBe(200)
    expect(h.cleared).toBe(1)
  })
})
