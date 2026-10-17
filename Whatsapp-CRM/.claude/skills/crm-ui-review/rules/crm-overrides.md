# CRM overrides to the Web Interface Guidelines

These win wherever they disagree with `web-interface-guidelines.md`. They
exist because this app already solves some rules globally (so flagging them
per file is noise), and because some upstream rules don't fit a CRM.

## Already handled globally — do NOT flag per file

`src/app/globals.css` covers these for every dashboard screen:

- **Focus ring:** every `button`, `a[href]`, `[role=button|tab|menuitem|option|checkbox|switch]`,
  `summary`, `select`, checkbox and radio gets a 2px `#5b6cf9` outline on
  `:focus-visible`. Only flag a control that *removes* it (`outline-none`,
  `outline: none`) without its own `focus-visible:` ring.
- **Reduced motion for CSS:** all CSS animations/transitions collapse under
  `prefers-reduced-motion: reduce`. Don't flag a Tailwind/CSS animation for
  missing a reduced-motion variant.
- **Touch:** `touch-action: manipulation` and the 44px invisible hit area for
  `h-6…h-8` / `size-6…size-8` icon buttons on coarse pointers.
- **Native select colours** in Windows dark mode.
- **Phone input zoom:** inputs/textarea/select are 16px on coarse pointers.

## Not covered globally — DO flag

- **JavaScript motion** (`element.animate(...)`, requestAnimationFrame loops,
  Framer-style libraries) must check `prefers-reduced-motion` itself.
- **`public/webchat/*`** (widget.js, frame.js, frame.css) runs on customers'
  websites and inside an iframe *without* globals.css: every rule applies
  there in full, including focus, reduced motion and touch.
- Animating anything other than `transform`/`opacity` (e.g. `box-shadow`,
  `width`, `top`, `background-position`) in a loop.

## Changed rules

- **Sentence case, not Title Case** for headings, buttons, tabs and labels
  ("Save changes", "Add number"). Flag Title Case in new copy.
- **First person is fine in customer-facing text** the business sends (bot
  replies, templates, Website Bot: "We will call you back"). Dashboard copy
  addresses the staff member in the second person.
- **URL reflects state:** required for list filters, search, pagination and
  the selected record (shareable, survives reload). Optional for tabs inside
  a settings card or a dialog — suggest, don't flag.
- **Virtualize lists > 50 items:** flag only lists whose length is
  unbounded and user-driven (conversations, contacts, messages, records).
  Bounded lists (members, templates, settings rows) are fine.
- **`autocomplete="off"`** on non-auth fields: yes. Phone fields may use
  `autocomplete="tel"` + `inputMode="tel"` when they are the user's own.
- **Placeholders end with `…`** only when they are a prompt ("Search
  contacts…"). Example values ("+91 85900 55117", "#4f46e5") stay as they
  are.

## CRM rules to add to every review

From `AGENTS.md` (the ten bug rules) and `DESIGN.md` — flag in UI code:

1. Reading `[0]`, `.map`, or a nested field on fetched data with no guard,
   or no empty state for an empty list.
2. A save that doesn't reload the list or use the server's reply; a full
   page reload after saving.
3. A `catch` on a user action with no visible message (toast) — console only.
4. Search-as-you-type without debounce or without a `loadSeq` ref.
5. `setInterval` polling instead of `everyWhileVisible`.
6. Create/pay/claim/save buttons not disabled while the request runs.
7. Plain `fetch` + "Saved" toast without checking the response — use
   `apiFetch` / `errorText` (`src/lib/api-fetch.ts`).
8. Email inputs without `autoCapitalize="none"` / without trim+lowercase.
9. Uploads without a size check and a clear message.
10. Dates built from the browser clock for business times, or formatted
    with a hardcoded pattern instead of `humanDate` / `Intl`.

Plus:
- User content rendered as HTML without DOMPurify.
- Hardcoded hex colours or `bg-green-*` where a semantic token
  (`bg-primary`, `text-primary`) is meant — the app has six themes.
- Text that would clip in Malayalam: fixed heights/widths on labels,
  `whitespace-nowrap` on long copy without `truncate` + `title`.
- Layout that overflows at 360px wide.
