import { describe, it, expect } from 'vitest'
import { makeNonce, strictCsp, reportingEndpoints } from './csp'

describe('makeNonce', () => {
  it('never repeats', () => {
    // A nonce that can be predicted is a nonce an injected script can
    // wear. 5 000 draws with no collision is not a proof, but a broken
    // generator — a constant, a counter, a low-entropy seed — fails it
    // immediately.
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) seen.add(makeNonce())
    expect(seen.size).toBe(5000)
  })

  it('is long enough to be worth calling random', () => {
    // 16 bytes, base64 → 24 characters.
    expect(makeNonce()).toHaveLength(24)
    expect(makeNonce()).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})

describe('strictCsp', () => {
  const policy = strictCsp('TESTNONCE')

  it('does not allow inline script — the entire point', () => {
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src'))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('carries the nonce it was given', () => {
    expect(policy).toContain("'nonce-TESTNONCE'")
  })

  it('still permits the two third parties the app loads by src', () => {
    // Withdrawing permission for inline script text must not also
    // withdraw permission for Razorpay's and Meta's own files, or the
    // report would be full of failures that say nothing about inline
    // script.
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src'))!
    expect(scriptSrc).toContain('https://*.razorpay.com')
    expect(scriptSrc).toContain('https://connect.facebook.net')
  })

  it('keeps inline styles allowed', () => {
    // Tailwind and a great many components set style attributes
    // directly. An injected style cannot run code, so the risk does not
    // justify the churn — and mixing that change into this one would
    // make the report impossible to read.
    expect(policy).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('keeps the protections the enforcing policy already has', () => {
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(policy).toContain(directive)
    }
  })

  it('names where to send violations, in both spellings', () => {
    // report-uri is obsolete but is what most browsers still act on;
    // report-to is its replacement. Sending one only means some
    // browsers report nothing, and silence would read as success.
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).toContain('report-to csp')
  })

  it('matches the name the Reporting-Endpoints header declares', () => {
    expect(reportingEndpoints()).toContain('csp=')
    expect(reportingEndpoints()).toContain('/api/csp-report')
  })

  it('gives each request its own policy', () => {
    expect(strictCsp(makeNonce())).not.toBe(strictCsp(makeNonce()))
  })
})
