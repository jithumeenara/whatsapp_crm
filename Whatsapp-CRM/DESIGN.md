# DESIGN.md — WhatsApp CRM

How this app should look and feel. `AGENTS.md` says how to build it; this
file says how it looks. Written from the code as it is (October 2026), in
the nine-section DESIGN.md format (Google Stitch / awesome-design-md).
Tokens live in `src/app/globals.css`; base components in
`src/components/ui/`. When this file and the code disagree, the code wins
and this file gets fixed.

---

## 1. Visual theme & atmosphere

A working tool for call-centre staff, admins and owners, used all day, often
on a phone. **Calm, dense, legible.** White cards on a near-white page, one
accent colour, slate text, soft borders, small shadows. Nothing decorative
competes with the data. Motion is short and functional. It feels like
WhatsApp Business crossed with Linear: familiar green, quiet chrome.

It serves any industry and any tenant (training institutes, hospitals,
shops). Never design for one customer's content.

## 2. Colour palette & roles

Default theme `whatsapp` (light). Five dark themes swap the accent and base:
`violet`, `emerald`, `cobalt`, `amber`, `rose` (`html[data-theme]`).
**Use the semantic tokens**, so every theme works:

| Role | Token / class | Default value |
|---|---|---|
| Page background | `bg-background` | near-white `oklch(0.975 …)` |
| Card / panel | `bg-card`, `bg-white` | white |
| Primary accent | `bg-primary`, `text-primary` | WhatsApp green `#25D366` |
| Primary hover / tints | `--primary-hover`, `--primary-soft`, `--primary-soft-2` | |
| Body text | `text-slate-800` / `text-foreground` | near-black |
| Secondary text | `text-slate-500`, `text-slate-600` | |
| Helper / meta text | `text-slate-400` | darkened to `#5f6f86` (4.8:1) — keep using it |
| Borders | `border-slate-200` (cards, inputs), `border-slate-100` (dividers) | |
| Destructive | `text-destructive`, `bg-rose-50 text-rose-700` | |
| Success | `bg-emerald-50 text-emerald-700` | |
| Warning | `bg-amber-50 text-amber-800` | |
| Info / selected | `bg-indigo-50 text-indigo-700`, `border-indigo-500` | |

Status colours always come as **soft background + dark text** of the same
hue, never bright text on white. Brand colours chosen by a tenant (Website
Bot, templates) are data: validate them as `#rrggbb` and never let them into
CSS unchecked.

## 3. Typography

- **Font:** Inter for Latin, **Anek Malayalam** for Malayalam (subsetted;
  supplies only the glyphs Inter lacks). One stack, `font-sans`, everywhere.
- **Root size is 18px** (`html { font-size: 18px }`), so `text-sm` is larger
  than in stock Tailwind. Screens use explicit pixel sizes:

| Use | Size | Weight |
|---|---|---|
| Page title | `text-[18px]`–`text-[20px]` | `font-semibold`/`font-bold` |
| Card / section heading | `text-[14px]`–`text-[15px]` | `font-semibold` |
| Body, table cells, inputs | `text-[13px]` | normal |
| Secondary lines | `text-[12px]`–`text-[12.5px]` | normal |
| Hints, meta, timestamps | `text-[11px]`–`text-[11.5px]` | normal |
| Badges, tiny labels | `text-[10px]`–`text-[10.5px]` | `font-semibold`, often `uppercase tracking-wide` |

- **Sentence case** for headings, buttons, tabs and labels: "Save changes",
  "New schedule", "Add number". Not Title Case.
- Malayalam runs longer and taller than English: never fix a height or width
  that would clip a translated label; let text wrap.
- Numbers in tables/counters: `tabular-nums`. Ellipsis `…`, not `...`.
- On phones every input is forced to 16px (globals.css) so iOS doesn't zoom.

## 4. Component stylings

Prefer the components in `src/components/ui/` (Base UI + shadcn style) over
hand-made ones.

- **Button** (`ui/button.tsx`): `h-8` default, `rounded-lg`,
  `font-semibold`. Variants: `default` (primary, soft coloured shadow),
  `outline`, `secondary`, `ghost`, `destructive` (soft red), `link`. Icon
  buttons use `size="icon*"` **and an `aria-label`**.
- **Inputs** (`ui/input`, `ui/textarea`, `ui/select`): `border-slate-200`,
  `rounded-lg`, focus ring. Every field has a visible label (`FieldLabel` /
  `Label` with `htmlFor`) or an `aria-label`.
- **Cards / panels:** `rounded-xl` or `rounded-2xl`, `border border-slate-200`,
  `bg-white`, `shadow-card` or `shadow-sm`; header row `px-5 py-4` with a
  `border-b border-slate-100`.
- **Badges / status pills:** `rounded-full px-2 py-0.5 text-[11px]
  font-semibold` in the soft status colours above, often with a 6px dot.
- **Tabs** (`ui/tabs`): `variant="default"` is a segmented pill (active tab
  on `bg-background` with a small shadow); `variant="line"` is an underline
  tab bar (active gets a 2px bar). Icons inside tabs are `size-4`.
- **Switches** (`ui/switch`) for on/off settings, with a sentence that says
  what "on" does.
- **Dialogs:** `ui/dialog`; destructive actions go through `useConfirm()`
  (`confirm-dialog.tsx`), never a bare `window.confirm`.
- **Toasts:** `sonner` — `toast.success` only after the server confirmed
  (`apiFetch`), `toast.error(errorText(err, '…'))` on failure.
- **Icons:** `lucide-react`, `h-4 w-4` in buttons and rows, `h-3.5 w-3.5` in
  small text. Decorative icons are `aria-hidden`.
- **Save bar:** settings forms show "Unsaved changes · Discard · Save
  changes" only when something changed.

## 5. Layout principles

- Dashboard shell: sidebar + content; content cards on `bg-background`.
- Spacing scale: `gap-2`/`gap-3` inside rows, `space-y-5`/`space-y-6`
  between form sections, `p-4`/`p-5` inside cards.
- Editor + preview screens: `grid lg:grid-cols-[minmax(0,1fr)_400px]`.
- Flex children that hold text get `min-w-0` so `truncate` works.
- **Phones first-class:** test at 360px. There is an `xs` breakpoint (26rem)
  between phone and `sm`. No horizontal page scroll (html/body clip it, but
  fix the overflowing element too).
- Tables collapse to cards or scroll inside their own container on phones.

## 6. Depth & elevation

Flat with a whisper of shadow:
- `shadow-card` (0 1px 3px / 6%) for resting cards, `shadow-card-md` for
  raised ones, `shadow-xl` only for popovers, dialogs, the Website Bot window.
- Borders do most of the separating; shadows don't stack on shadows.
- Corner radius comes from one token, `--radius: 0.5rem`; every `rounded-*`
  derives from it. Don't hand-tune radii per component.

## 7. Do's and don'ts

**Do**
- Show an empty state for empty data, a short error message for a failed
  action, and a spinner/disabled button while a request runs (the ten bug
  rules in `AGENTS.md`).
- Keep focus visible. globals.css already gives every button/link a 2px
  `#5b6cf9` focus outline; don't remove it without a replacement.
- Respect `prefers-reduced-motion`. globals.css stops CSS animations
  app-wide — **but not** JavaScript (Web Animations API) motion, and **not**
  `public/webchat/*` (it runs on customers' sites without our CSS).
- Animate only `transform` and `opacity`; list transition properties.
- Use `Intl` / `humanDate` for dates and numbers, in the business time zone.

**Don't**
- `<div onClick>` — use `<button>` or `<a>`.
- `transition: all`, `outline-none` without a replacement, `user-scalable=no`.
- Bright brand colours as text on white, or raw tenant input in CSS/HTML.
- Title Case buttons, "..." for an ellipsis, "Continue" as a button label
  when it could say what it does.
- Decorative gradients, glassmorphism, emoji as icons in the dashboard.
  (Customer-facing pieces — Website Bot, templates — may be livelier.)

## 8. Responsive behaviour

Breakpoints: `xs` 26rem (416px, added in globals.css for the phone band),
then Tailwind's `sm` 640, `md` 768, `lg` 1024, `xl` 1280.

- Design for 360px first; add columns at `xs`/`sm`; put editor + preview
  side by side only from `lg`.
- Grids that hold cards use `grid-cols-1` → `sm:grid-cols-2` → `lg:grid-cols-3`
  rather than fixed widths.
- Anything wider than the screen (tables, code, long URLs) scrolls inside
  its own container or wraps (`break-words`), never the page.

Touch: icon buttons smaller than 44px get an invisible 44px hit area
automatically on coarse pointers (globals.css) — keep using the `h-8`/`size-8`
classes so it applies.

## 9. Agent prompt guide

When building or changing UI in this repo:

1. Read this file and reuse `src/components/ui/*` before writing new markup.
2. Use the semantic tokens and the sizes in §3; sentence case copy.
3. Check every new screen at 360px and in one dark theme
   (`document.documentElement.dataset.theme = 'violet'`).
4. Run the **`crm-ui-review`** skill on the files you changed
   (`.claude/skills/crm-ui-review`) and fix what it finds.
5. Look at it: **`playwright-cli`** (`.claude/skills/playwright-cli`) can
   open the dev server, click through, emulate reduced motion and dark
   colour schemes, and screenshot. Saved logins (`*.auth-state.json`) are
   git-ignored — never commit one.
