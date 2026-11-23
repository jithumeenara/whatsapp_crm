---
name: verify
description: Prove a change works by running the CRM like a real user — start the dev server, open the changed screen and the main flows in a browser at 360px and 1280px, screenshot each step, read the console — and report pass/fail per step. Use before saying a screen or flow change is done or fixed, and whenever asked "does it work?".
---

# Verify: prove it works, don't say it works

Unit tests check the pieces; a customer uses the whole page. "Done" for a
screen or flow change means this report, not only `npm test`.

## 1. Start the app safely

- Development only: `APP_ENV=development` (every outgoing message is stopped,
  background jobs are off — `src/lib/dev/send-guard.ts`). Never point it at a
  production database; the local `.env.local` database is stale (memory:
  local-db-is-not-production). Never run this against `crm_prod_copy`.
- Start: `PORT=3007 npx tsx --env-file=.env.local server.ts` (run in the
  background). Wait for `Ready on http://localhost:3007`.
- If it will not start, that is a failed check: report the error and stop.

## 2. Get past login without real credentials

There is no known local login. For a dashboard screen, use the harness from
memory local-ui-test-harness: a temporary page under the public `/f/` prefix
(`src/app/f/zz-<name>/page.tsx`) that renders the component, with a
`window.fetch` stub returning fixture JSON. **Delete `src/app/f/zz-*` before
any commit** and check `git status`.

## 3. Walk the flow like a customer

With the `playwright-cli` skill (or the Playwright MCP tools):

1. Open the changed screen at **360px** wide, then at **1280px**.
2. Do what a person does: click, type, save. Don't call functions directly.
3. Also open the main flows the change could touch, as far as the harness
   allows: Inbox (open a conversation), Leads (list → one lead),
   Settings (the changed tab), Ads (a campaign profile).
4. Expected results are what the request said "done" means, in customer words.

## 4. Proof for every step

- Screenshot after each step (keep them in `.playwright-mcp/` or
  `.playwright-cli/`, both git-ignored).
- Read the browser console after each step. A red error is a failed step,
  even if the page looks right.
- Check at 360px: nothing cut off, no sideways scroll, buttons reachable.
- A step passes only if the expected result was seen on screen.

## 5. Report

A table: step · pass/fail · screenshot · what was seen.

- All passed: say "verified" and list the screenshots.
- Something failed: fix the cause, then run the whole check again from step 1.
- **3 failed rounds: stop.** Say what fails, what was tried, and the best
  guess at the cause. Don't start a 4th round.

## Never

- Never edit a test, this file or any other check to make it pass.
- Never say "done" or "fixed" for a screen change without this report.
- Never commit the harness pages, fixtures with real data, or `*.auth-state.json`.
