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

# Data safety (never broken, not even to fix an error)

- **Never** run a database reset, `DROP`, `TRUNCATE`, `prisma migrate reset`, `db push --force-reset` or a `DELETE`/`deleteMany` without a `where`, on any database. Write a migration file in `supabase/migrations/` and stop. If a migration fails, show the error and wait.
- A migration must be safe to run twice (`IF NOT EXISTS`, guarded `DO` blocks) and is dry-run inside `BEGIN … ROLLBACK` on `crm_prod_copy` first.
- **Deleting a user never deletes business data.** Links from business tables to `users` are `ON DELETE RESTRICT` (migration 132); a removed member is switched off with `deactivateMember` (`src/lib/auth/deactivate-member.ts`), never deleted and never made an owner.
- Restoring a database is done on the server, into a new database first — never from the app. Only the server owner (`isPlatformOwner`) may download a whole-database backup.
- Development machines have `APP_ENV=development`: every outgoing message is stopped (`src/lib/dev/send-guard.ts`) and background jobs are off. Never set it on a server; never add a send path that bypasses `fetch`.

# Security rules for every new route

1. Server-side check before any read or write: `requireRole(...)`, and every record loaded **with** `account_id: ctx.accountId` (an id from the URL is never enough).
2. Copy allowed fields one by one from the body — never `data: body`; users never set their own role, account, price, status or ids.
3. Validate type, length and allowed values on the server; the browser's checks are a convenience.
4. Raw SQL only through `Prisma.sql` / `$queryRaw` tagged templates; a column name from input goes through an allow-list.
5. Never render user content as HTML except through DOMPurify.
6. Uploads: real type checked from the bytes (`contentMatchesType`), size capped, stored under a random name.
7. Return only the fields the screen needs — never tokens, secrets, password hashes or other accounts' data.
8. Public or paid (AI, SMS, email) routes get `checkRateLimit`.
9. Error responses say what went wrong in plain words; stack traces and raw library errors stay in the server log.

# Bugs and tests (test first: "fixed" means a test went red → green)

- A reported bug that touches money (prices, totals, payments, refunds), login / who can see what, or that came back after a fix: write a failing test first (`src/**/*.test.ts`, next to the code) and show it failing **for the bug's reason**, not a typo or import error. Change no other code until it has failed. Bugs seen only in the browser get a Playwright click-through instead. Typos, colours and spacing need no test.
- Never edit, delete, skip or loosen an existing test to make it pass. If a test looks wrong, stop and ask.
- Fix the cause with the smallest change; don't hard-code the expected answer or special-case the test's input. List other problems found; leave them alone.
- Before saying "fixed": run that test, then the whole suite (`npm test`), and show both. Commit the test with the fix, naming the bug it covers. Run `npm test` before starting a new feature; if anything is red, stop and say so.

# UI work

- How the app looks: `DESIGN.md` (tokens, sizes, components, sentence case). Reuse `src/components/ui/*`.
- Before calling a screen done: run the `crm-ui-review` skill on the changed files (pinned Web Interface Guidelines + CRM overrides, no network) and fix what it finds.
- Look at it, don't assume: the `playwright-cli` skill drives a real browser (360px, dark theme, reduced motion). Saved logins (`*.auth-state.json`) and `.playwright-cli/` output are git-ignored; never commit one.
- `public/webchat/*` runs on customers' websites without `globals.css`: focus, reduced motion and touch rules must be in the file itself.
