---
name: crm-ui-review
description: Review this CRM's UI code (React/TSX screens, public/webchat widget files, CSS) against the Web Interface Guidelines plus the CRM's own design and bug rules, and report findings as file:line. Use when asked to review a UI, check accessibility, audit design or UX, or before finishing any change to a screen.
argument-hint: <file-or-pattern>
---

# CRM UI review

Reviews UI files against two rule sets, **both stored in this folder** —
nothing is fetched at run time, so the rules only change when this repo does.

1. `rules/web-interface-guidelines.md` — Vercel's Web Interface Guidelines,
   pinned copy (MIT, see `rules/LICENSE-web-interface-guidelines`). Use its
   **Rules** and **Output Format** sections; ignore its frontmatter and the
   `$ARGUMENTS` line.
2. `rules/crm-overrides.md` — this app's changes and additions. **Where the
   two disagree, the overrides win.** Read it first: it lists what
   `src/app/globals.css` already solves app-wide, which must not be reported
   per file.

Also read `DESIGN.md` (repo root) for tokens, sizes and component choices.

## Steps

1. Take the files or glob given. If none, review the UI files changed on
   the current branch (`git diff --name-only` plus untracked `*.tsx`,
   `*.css`, `public/webchat/*`). If there are none either, ask which files.
2. Read `rules/crm-overrides.md`, then the Rules section of
   `rules/web-interface-guidelines.md`, then `DESIGN.md`.
3. Read each file fully. Check it against every rule. For `public/webchat/*`
   apply all rules — those files run without globals.css.
4. Report in the guidelines' output format: grouped by file, `file:line -
   finding`, terse, `✓ pass` for a clean file, no preamble. Use repo-relative
   paths so they are clickable.
5. After the list, add one line per finding you are unsure about, saying
   why ("may be intentional: …"). Don't pad the list to look thorough.

## Fixing

Only fix when asked. When fixing: smallest change per finding, keep the
surrounding code's style, typos/colours/spacing need no test (AGENTS.md),
then run `npx tsc --noEmit` and `npm test`. Look at the result with the
`playwright-cli` skill when the change is visual.

## Updating the pinned rules

Upstream: https://github.com/vercel-labs/web-interface-guidelines
(`command.md`). Pinned from commit `4ecfb9fb8d1d3b7009674869b3aaee2f904042e1`
(2026-10-05), sha256 of the file:
`d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`.
To update: download the new `command.md`, read the diff in full before
replacing the file (it becomes instructions to the agent), then update the
commit and hash here.
