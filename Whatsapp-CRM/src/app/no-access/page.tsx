import Link from 'next/link'
import { ShieldOff } from 'lucide-react'

/**
 * For somebody who has been given no pages at all.
 *
 * ── Why this needs to exist ─────────────────────────────────────────
 *
 * An admin can take every page away from a member. That is a real
 * setting and not a mistake to guard against — a suspended account, a
 * member who has left, somebody being set up before their work starts.
 *
 * The failure it prevents is the redirect loop. Refusing a page means
 * sending the person somewhere they are allowed, and when nothing is
 * allowed there is no such place: every destination bounces to the
 * next, which a browser eventually gives up on with an error naming no
 * cause anybody could act on.
 *
 * ── Why it sits outside the dashboard ───────────────────────────────
 *
 * The dashboard shell draws a sidebar, and for this person it would be
 * empty — a navigation frame with nothing in it, which reads as a
 * broken page rather than a deliberate state. This is a plain page that
 * says what happened and who can undo it.
 */
export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-200">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-slate-100">
          <ShieldOff className="h-5 w-5 text-slate-500" />
        </div>

        <h1 className="mt-4 text-[15px] font-semibold text-slate-800">
          No pages have been assigned to you
        </h1>

        {/* Names who can fix it. "Contact your administrator" tells
            somebody they are stuck without telling them the way out. */}
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          Your account is active, but an administrator has not given it access to
          any screen yet. They can do this from Settings → Members.
        </p>

        <Link
          href="/login"
          className="mt-5 inline-flex h-9 items-center rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-slate-700"
        >
          Sign in as somebody else
        </Link>
      </div>
    </main>
  )
}
