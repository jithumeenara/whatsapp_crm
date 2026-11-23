# Open bugs

One line per bug: what breaks, where, how to see it. Colour by two questions:
does it block a user (can't log in, can't pay, loses data)? and how many hit it?

- 🔴 **Red** — blocks users: fix today, before any new feature.
- 🟡 **Yellow** — slows or confuses, has a workaround: this week.
- 🟢 **Green** — looks only, or rare: later.

Fix one at a time, red first, each with a test that fails first (AGENTS.md).
When fixed: move it to the bottom with the commit that fixed it.

## How to report a bug

```
Where:      page / feature, and which server (ACSTI or Hospital)
Steps:      1 … 2 … 3 …
Expected:   …
Got:        …
Error:      exact text (screenshot, pm2 log line, Settings → Errors)
Works fine: what must not be touched
```

## Red

_(none known)_

## Yellow

- **Lead status accepts any text** — `PATCH /api/leads/[id]` saves `status` without checking it against the allowed list; a bad value hides the lead from every status filter. An existing test pins today's behaviour, so changing it needs the owner's OK first (AGENTS.md: never loosen a test). Add a DB check constraint with the fix.
- **Knowledge Base: 11 known issues** — text edit, training status, sheet rows cut, etc. Listed in `docs/plans/knowledge-base-plan.md`; five decisions pending from the owner.

## Green

- **Two tests fail on Windows only** — `src/app/api/files/[...path]/route.test.ts` (a file name with `"` cannot exist on Windows) and `src/lib/db/db-scripts.test.ts` backup mode check (no chmod 600 on Windows). They pass on the Linux servers.
- **Messenger replies reach only people with an app role** — Meta App Review (pages_messaging, instagram_manage_messages) is needed before real customers get replies. Not a code bug.

## Fixed

_(move fixed bugs here with their commit)_
