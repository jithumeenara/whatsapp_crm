import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDev = process.env.NODE_ENV === "development";

/**
 * This directory, resolved from the config file's own location.
 *
 * import.meta.url rather than __dirname: this file is ESM, where
 * __dirname does not exist, and process.cwd() is wherever the build was
 * launched from rather than where the app actually lives.
 */
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Baseline security headers applied to every response.
 *
 * CSP is enforced via `Content-Security-Policy`.
 * `'unsafe-inline'` is required for Next.js hydration scripts and
 * Tailwind inline styles; `'unsafe-eval'` is used in dev mode only.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: everything we don't use is denied outright,
 *     so a supply-chain compromise or a forgotten plugin can't silently
 *     opt back in. `microphone=(self)` is the one exception — the AI
 *     voice console needs it, and `()` denies the feature to *every*
 *     origin including this one, which is a document-level block no
 *     browser or operating system permission can override.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // microphone=(self): needed by the live voice console in Settings →
    // AI Config, and by dictation in the inbox composer.
    //
    // This was "microphone=()" — deny to all origins — which is a
    // document-level refusal that sits above every other permission.
    // The symptom was thoroughly misleading: the browser's own site
    // panel showed the microphone allowed, Windows was allowing it, and
    // getUserMedia still threw NotAllowedError while
    // navigator.permissions reported "denied". Every one of those is
    // correct behaviour for a policy-denied document, and none of them
    // points at the header.
    //
    // (self) and not (*): only this origin, never an embedded frame.
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script.
      // 'unsafe-eval' is restricted to dev only — Turbopack uses it but
      // production builds do not need it.
      // Razorpay checkout.js and any scripts it loads dynamically.
      // connect.facebook.net serves Meta's JS SDK, loaded client-side for
      // WhatsApp/Instagram/Facebook Embedded Signup (FB.init/FB.login) —
      // without it here the script silently fails to load and the
      // "Connect with Facebook" button is stuck disabled forever, with no
      // console error a non-technical user would notice.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://*.razorpay.com https://connect.facebook.net`,
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). Most Meta API calls happen
      // server-side, but the Embedded Signup JS SDK itself pings
      // *.facebook.com client-side (cookie/session sync, app-event
      // logging) once loaded, so that needs to be allowed too.
      // Razorpay: wildcard covers checkout.razorpay.com, api.razorpay.com,
      // cdn.razorpay.com, lumberjack.razorpay.com and any other subdomains
      // the checkout modal needs.
      // The live voice console opens ws(s)://<this host>/api/ai/live-voice.
      // 'self' covers a same-origin WebSocket — CSP3 matches ws/wss
      // against an http/https origin of the same host and port, and
      // Chromium implements it — so no extra entry is needed here.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.razorpay.com https://*.facebook.com",
      // Razorpay checkout modal renders as an iframe — wildcard covers all subdomains.
      // *.facebook.com: the Embedded Signup JS SDK opens its own login
      // dialog and a hidden cross-domain-communication iframe from here.
      "frame-src https://*.razorpay.com https://*.facebook.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  /**
   * Pin the workspace root rather than letting Turbopack infer it.
   *
   * Inference walks upwards looking for a lockfile and takes the
   * highest one it finds. On a server with a stray package-lock.json in
   * the parent directory it therefore chose the parent, and resolved
   * PostCSS plugins against a node_modules that does not contain them —
   * failing with "Cannot find module '@tailwindcss/postcss'" while the
   * package sat correctly installed one directory down.
   *
   * The error names a missing module, so it reads as a dependency
   * problem rather than a path one, and reinstalling does not fix it.
   * Pinning the root makes the build independent of whatever else
   * happens to sit above the app on a given machine.
   */
  turbopack: { root: APP_ROOT },

  serverExternalPackages: ["exceljs"],
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "sonner"],
  },
  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  // Nothing is gained by telling every caller which framework and
  // therefore which advisories to go and read. Next.js sends this
  // header by default; there is no reason to.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path((?!_next/static|_next/image|api).*)",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300",
          },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
