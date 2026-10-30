import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

/**
 * The parts of next.config.ts that are security decisions, pinned so a
 * later edit has to change a test to change them.
 */

describe('next.config.ts', () => {
  it('turns off the image optimizer, which nothing in the app uses', () => {
    // No next/image anywhere in src/: /_next/image was a public endpoint
    // that fetched and re-encoded images for nobody. Off, it answers 404
    // (next-server.js checks images.unoptimized before doing anything).
    expect(nextConfig.images?.unoptimized).toBe(true)
    expect(nextConfig.images?.dangerouslyAllowSVG).not.toBe(true)
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([])
    expect(nextConfig.images?.domains ?? []).toEqual([])
  })

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('never lets a shared cache keep an API answer or a page', async () => {
    const rules = await nextConfig.headers!()
    const api = rules.find((r) => r.source === '/api/:path*')
    expect(api?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' })
    const pages = rules.find((r) => r.source.startsWith('/:path((?!_next/static'))
    expect(pages?.headers.find((h) => h.key === 'Cache-Control')?.value).toMatch(/^private, no-cache/)
  })

  it('sends the security headers everywhere but the chat frame keeps its own framing rules', async () => {
    const rules = await nextConfig.headers!()
    const all = rules.find((r) => r.source === '/:path((?!api/webchat/frame/).+)')!
    const keys = all.headers.map((h) => h.key)
    for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Content-Security-Policy', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(keys).toContain(k)
    }
    const csp = all.headers.find((h) => h.key === 'Content-Security-Policy')!.value
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
    const frame = rules.find((r) => r.source === '/api/webchat/frame/:key')!
    expect(frame.headers.map((h) => h.key)).not.toContain('X-Frame-Options')
  })
})

/** The header rules that apply to `path`, for the source forms used in next.config.ts. */
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!()
  const out: Record<string, string> = {}
  for (const r of rules) {
    const m = /^(.*?):[a-z]+\((.*)\)$/.exec(r.source)
    const re = m ? new RegExp(`^${m[1]}${m[2]}$`) : r.source.endsWith(':path*')
      ? new RegExp(`^${r.source.replace(':path*', '')}.*$`)
      : r.source.includes(':') ? new RegExp(`^${r.source.replace(/:[a-z]+/g, '[^/]+')}$`) : new RegExp(`^${r.source}$`)
    if (re.test(path)) for (const h of r.headers) out[h.key] = h.value
  }
  return out
}

describe('cross-origin isolation headers', () => {
  it('pages are opener-isolated but keep the popups they open (Facebook/Google sign-in)', async () => {
    for (const page of ['/', '/dashboard', '/inbox', '/login', '/f/abc']) {
      expect((await headersFor(page))['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
    }
  })

  it('leaves the Google sign-in landing page without COOP, so it can reach its opener', async () => {
    expect((await headersFor('/google-done'))['Cross-Origin-Opener-Policy']).toBeUndefined()
  })

  it('API answers cannot be embedded by other sites, except the ones made for them', async () => {
    expect((await headersFor('/api/contacts'))['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect((await headersFor('/api/files/1/download'))['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect((await headersFor('/api/webchat/config/k'))['Cross-Origin-Resource-Policy']).toBeUndefined()
    expect((await headersFor('/api/webchat/frame/k'))['Cross-Origin-Resource-Policy']).toBeUndefined()
    expect((await headersFor('/api/meta-ads/track'))['Cross-Origin-Resource-Policy']).toBeUndefined()
    // The widget script runs on customers' own websites.
    expect((await headersFor('/webchat/loader.js'))['Cross-Origin-Resource-Policy']).toBeUndefined()
  })
})
