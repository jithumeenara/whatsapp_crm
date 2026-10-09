<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ten bug rules (apply to every change)

Each of these once worked "for me" and failed for real users. Check every
new feature or fix against all ten before calling it done.

1. **Empty data** — never read `[0]`, `.map` or a nested field without a guard; show an empty state. Page crashes are caught by `src/app/(dashboard)/error.tsx` and `src/app/global-error.tsx` (this Next passes `retry`, not `reset`).
2. **List updates after save** — reload it or use what the server returned. No full page reload.
3. **No silent errors** — a catch on something a user did shows a short message; keep the console log.
4. **Search-as-you-type** — debounce, and let only the newest response write (a `loadSeq` ref counter).
5. **No refetch loops; polls rest when hidden** — background polling uses `everyWhileVisible` (`src/lib/visible-interval.ts`), except alerts that must sound in a background tab.
6. **Twice is once** — lock create/pay/claim buttons while the request runs; make the server atomic or idempotent (conditional `updateMany`, dedupe on external ids such as the Meta message id).
7. **"Saved" only after the server confirms** — use `apiFetch` / `errorText` from `src/lib/api-fetch.ts`; plain `fetch` resolves on 4xx/5xx.
8. **Emails ignore case** — trim + lowercase on save, compare with `mode: 'insensitive'`, `autoCapitalize="none"` on inputs (unique `lower(email)` index, migration 122).
9. **Upload limits end to end** — WhatsApp image 5 MB (`shrinkImageForWhatsApp`), routes 16 MB, `proxyClientMaxBodySize` 17mb, nginx on the VPS; a too-big file gets a clear message.
10. **Times keep their zone** — browsers send ISO with an offset (`new Date(local).toISOString()`); servers never read or format the server clock for business times — use `businessTimezone` / `humanDate` (`src/lib/ai/human-date.ts`) and `minutesNowIn` (`src/lib/agents/working-hours.ts`).
