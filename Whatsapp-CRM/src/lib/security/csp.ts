/**
 * The Content-Security-Policy this app would like to enforce, and the
 * one it enforces today.
 *
 * ── What is wrong with the policy in next.config.ts ─────────────────
 *
 * It contains `script-src 'unsafe-inline'`. That single token is what
 * CSP mainly exists to remove: with it, a successful injection anywhere
 * on a page — a contact name, a message body, a lead note — runs as
 * script. The rest of the policy is careful and that one word undoes
 * most of it.
 *
 * It is there for a real reason. Next.js emits inline scripts to hand
 * the server-rendered page over to React, and without `'unsafe-inline'`
 * a strict policy blocks them and the app renders as dead HTML.
 *
 * ── The way out, and why it is not simply "delete the token" ────────
 *
 * The supported fix is a nonce: a fresh random value per request, named
 * in the policy and stamped on every script the framework emits.
 * Nothing else on the page can guess it, so Next's own scripts run and
 * an injected one does not.
 *
 * Next.js does this itself when the request carries a CSP header with a
 * nonce in it, which is what the proxy sets up. But the page also loads
 * Razorpay's checkout and Meta's JS SDK, and whether either executes an
 * inline script of its own is not something this codebase can know by
 * reading itself. Guessing wrong means a payment page that silently
 * fails to open — on a live CRM, for a business taking money.
 *
 * ── So the strict policy ships as report-only first ─────────────────
 *
 * `Content-Security-Policy-Report-Only` asks the browser to evaluate a
 * policy and report what it would have blocked, while blocking nothing.
 * The enforcing policy in next.config.ts is untouched and keeps the app
 * working exactly as it does today.
 *
 * That turns an argument into an observation. Use the CRM normally —
 * including one real Razorpay payment and one Embedded Signup — and
 * every violation arrives at /api/csp-report with the file and line
 * that caused it. If nothing arrives, the strict policy is safe to
 * enforce and the change is one line. If Razorpay does need something,
 * it says exactly what, and the policy can grant precisely that instead
 * of `'unsafe-inline'` for everything.
 *
 * Measuring costs a few days. Guessing costs a payment page.
 */

/**
 * A fresh nonce.
 *
 * `crypto.getRandomValues` rather than `Math.random`: the value has to
 * be unguessable, because anything that can predict it can write a
 * script tag the policy will accept. Base64 of 16 random bytes is the
 * shape CSP expects and comfortably beyond guessing.
 *
 * Runs in the edge runtime, where Web Crypto is available and Node's
 * `crypto` module is not.
 */
export function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * The policy we are working towards, built around `nonce`.
 *
 * Identical to the enforcing policy except for `script-src`, which
 * trades `'unsafe-inline'` for the nonce. Keeping everything else the
 * same is deliberate: the report should be about the one change under
 * test, not about a dozen differences at once.
 */
export function strictCsp(nonce: string, reportUri = '/api/csp-report'): string {
  return [
    "default-src 'self'",
    // The one line under test. The host allowances stay — a script
    // loaded by src from Razorpay or Meta is still permitted; what is
    // withdrawn is permission for inline script text.
    `script-src 'self' 'nonce-${nonce}' https://*.razorpay.com https://connect.facebook.net`,
    // Styles keep 'unsafe-inline'. Tailwind and a great many components
    // set style attributes directly, and an injected style cannot run
    // code — the risk is not comparable and the churn would be.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.razorpay.com https://*.facebook.com",
    "frame-src https://*.razorpay.com https://*.facebook.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Both spellings: report-uri is obsolete but is what most browsers
    // still act on; report-to is the replacement and needs a matching
    // Reporting-Endpoints header, which the proxy sets.
    `report-uri ${reportUri}`,
    'report-to csp',
  ].join('; ')
}

/** Names the endpoint that `report-to csp` above refers to. */
export function reportingEndpoints(reportUri = '/api/csp-report'): string {
  return `csp="${reportUri}"`
}
