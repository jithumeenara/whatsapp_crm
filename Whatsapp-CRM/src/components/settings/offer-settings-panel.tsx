'use client'

/**
 * Whether a handover rings somebody, and for how long.
 *
 * ── Why this is separate from the judgement switch ──────────────────
 *
 * They are two decisions and conflating them would force a bad trade.
 * The judgement decides what an offer *knows* — which subject, how
 * urgent. This decides whether anybody's screen makes a noise. An
 * account should be able to watch the assistant think for a fortnight
 * with nothing ringing, and that is exactly the recommended way to
 * start.
 *
 * ── Why the numbers have hard floors ────────────────────────────────
 *
 * Both of these can be set to something that quietly ruins the feature.
 * Fifteen seconds is not a window an agent mid-sentence can answer, so
 * every offer times out and the whole team learns the alert is not
 * worth turning to. A concurrent limit of eight means everybody is
 * always under the cap, so the cap stops doing anything and quality
 * falls where nobody is measuring it. The inputs say what each number
 * does rather than presenting them as free choices.
 */

import { Bell, Timer, Users } from 'lucide-react'

interface Values {
  offer_enabled: boolean
  offer_seconds: number
  max_concurrent_chats: number
}

export function OfferSettingsPanel({
  values,
  onChange,
}: {
  values: Values
  onChange: (patch: Partial<Values>) => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50">
          <Bell className="h-4 w-4 text-rose-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-800">
                Ring somebody when the assistant gives up
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                The conversation is offered to one person at a time — whoever knows the subject, is
                on shift, is signed in and has the fewest chats open. They get a countdown and a
                sound. If they do not take it, it moves on.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={values.offer_enabled}
              aria-label="Offer handovers to an agent"
              onClick={() => onChange({ offer_enabled: !values.offer_enabled })}
              className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
                values.offer_enabled ? 'bg-[#5B6CF9]' : 'bg-slate-200'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  values.offer_enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {values.offer_enabled && (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                    <Timer className="h-3.5 w-3.5 text-slate-400" />
                    Seconds to answer
                  </span>
                  <input
                    type="number"
                    min={15}
                    max={600}
                    value={values.offer_seconds}
                    onChange={(e) => onChange({ offer_seconds: Number(e.target.value) })}
                    className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-[13px] tabular-nums text-slate-700 focus:border-[#5B6CF9] focus:outline-none"
                  />
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                    Sixty is the default. A chat widget would use thirty, but on WhatsApp the
                    customer is not watching a screen and the agent is usually mid-sentence with
                    somebody else. Too short and every offer times out.
                  </span>
                </label>

                <label className="block">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    Chats at once, per agent
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={values.max_concurrent_chats}
                    onChange={(e) => onChange({ max_concurrent_chats: Number(e.target.value) })}
                    className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-[13px] tabular-nums text-slate-700 focus:border-[#5B6CF9] focus:outline-none"
                  />
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                    Nobody is offered a new one past this. Three is where experienced agents sit;
                    past four, quality falls in ways nobody is measuring. Set it high and the cap
                    stops doing anything.
                  </span>
                </label>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3">
                <p className="text-[11.5px] font-medium text-slate-600">What it will not do</p>
                <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-slate-500">
                  <li>
                    · It goes round the team twice and stops. Four people at lunch would otherwise
                    mean an alert a minute, all night, until nobody hears any of them.
                  </li>
                  <li>
                    · It never rings for something the assistant judged quiet — a wrong number, a
                    supplier, somebody asking about jobs.
                  </li>
                  <li>
                    · It never locks a conversation. Anybody free can simply take it, which ends the
                    offer without counting as a miss.
                  </li>
                  <li>
                    · When nobody takes it, the conversation stays open to everybody and a note goes
                    on the thread saying who was asked.
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
