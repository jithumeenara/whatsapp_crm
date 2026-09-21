"use client"

import { useEffect, useState } from "react"
import { Sparkles, ShieldBan, Gauge, Info } from "lucide-react"
import {
  LEAD_SIGNALS,
  SIGNAL_GROUPS,
  THRESHOLD_LABELS,
  type LeadThreshold,
} from "@/lib/leads/ai-signals"

/**
 * Teaching the assistant what this business counts as a lead.
 *
 * ── Why it is a checklist and two text boxes ────────────────────────
 *
 * The checklist is what most businesses need and can be ticked in
 * fifteen seconds. The two boxes are what makes it work outside one
 * industry: a training institute and a spare-parts wholesaler tick the
 * same four boxes and mean different things, and only they can say
 * what else counts and what never does.
 *
 * The exclusions box earns its place separately. Every account that
 * turns something like this on discovers the same week that it keeps
 * flagging one specific kind of message — job applicants, other
 * businesses selling something, students doing a project — and without
 * somewhere to say so, their only options are to live with it or to
 * switch the whole thing off.
 *
 * ── Why the accuracy figure is here and not in a doc ────────────────
 *
 * Nobody should take our word for how well this works. Every accept and
 * reject is counted, and once there are enough of them the account sees
 * its own number, from its own inbox. It is also what makes the "create
 * directly" switch an informed decision rather than a leap.
 */

export interface AiLeadValues {
  ai_lead_enabled: boolean
  ai_lead_signals: string[]
  ai_lead_rules: string
  ai_lead_exclusions: string
  ai_lead_threshold: string
  ai_lead_mode: string
  /** 'off' | 'observe' | 'act' — whether the assistant may judge a
   *  handover at all, and whether it may act on what it works out.
   *  Lives with these because one Save writes the whole screen. */
  ai_judgement_mode: string
  /** Whether a handover is offered to one named agent with a clock on
   *  it. Independent of ai_judgement_mode: the judgement decides what
   *  an offer knows, this decides whether offers happen. */
  offer_enabled: boolean
  offer_seconds: number
  max_concurrent_chats: number
  ai_lead_min_messages: number
  ai_lead_recheck_hours: number
}

interface Accuracy {
  reviewed: number
  accepted: number
  percent: number
  pending: number
}

/** Enough decisions that the percentage is describing a pattern rather
 *  than the last few afternoons. Below this the figure is hidden and
 *  the count is shown instead. */
const MIN_REVIEWS_FOR_A_PERCENTAGE = 20

export function AiLeadSettings({
  values,
  onChange,
}: {
  values: AiLeadValues
  onChange: (patch: Partial<AiLeadValues>) => void
}) {
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null)

  useEffect(() => {
    fetch("/api/leads/ai-accuracy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAccuracy(d))
      .catch(() => {})
  }, [])

  const on = values.ai_lead_enabled
  const selected = new Set(values.ai_lead_signals)

  function toggleSignal(key: string) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange({ ai_lead_signals: [...next] })
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* ── The switch ── */}
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50">
          <Sparkles className="h-4 w-4 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-800">Find leads with AI</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            After the assistant replies, it reads the conversation and decides whether this person
            is worth following up. If a lead already exists it marks that one instead of making a
            second. It only looks at chats nobody has claimed, and only once every few hours.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange({ ai_lead_enabled: !on })}
          className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:ring-offset-2 ${
            on ? "bg-violet-600" : "bg-slate-200"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
              on ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {on && (
        <div className="space-y-6 border-t border-slate-100 p-5">
          {/* ── What counts ── */}
          <section>
            <p className="text-[13px] font-semibold text-slate-800">What counts as a lead here</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Tick anything that would make you want to call this person back.
            </p>

            <div className="mt-3 space-y-4">
              {SIGNAL_GROUPS.map((group) => (
                <div key={group}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {group}
                  </p>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {LEAD_SIGNALS.filter((s) => s.group === group).map((signal) => {
                      const checked = selected.has(signal.key)
                      return (
                        <button
                          key={signal.key}
                          type="button"
                          onClick={() => toggleSignal(signal.key)}
                          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                            checked
                              ? "border-violet-200 bg-violet-50/70"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              checked
                                ? "border-violet-600 bg-violet-600"
                                : "border-slate-300 bg-white"
                            }`}
                          >
                            {checked && (
                              <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-white stroke-2">
                                <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={`block text-[12.5px] font-medium ${
                                checked ? "text-violet-900" : "text-slate-700"
                              }`}
                            >
                              {signal.label}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {selected.size === 0 && !values.ai_lead_rules.trim() && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                Nothing is ticked and no rule is written, so nothing will ever be flagged.
              </p>
            )}
          </section>

          {/* ── The account's own words ── */}
          <section className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="text-[12.5px] font-semibold text-slate-700">
                Anything else that counts
              </span>
              <span className="mt-0.5 block text-[11.5px] text-slate-500">
                In your own words. These beat the list above.
              </span>
              <textarea
                value={values.ai_lead_rules}
                onChange={(e) => onChange({ ai_lead_rules: e.target.value })}
                rows={4}
                maxLength={4000}
                placeholder={
                  "e.g. Anyone asking about the Dubai branch, even just for information.\nAnyone who mentions they were referred by an existing customer."
                }
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] leading-relaxed text-slate-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>

            <label className="block">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700">
                <ShieldBan className="h-3.5 w-3.5 text-rose-500" />
                Never count these
              </span>
              <span className="mt-0.5 block text-[11.5px] text-slate-500">
                The box that keeps the list clean. These beat everything else.
              </span>
              <textarea
                value={values.ai_lead_exclusions}
                onChange={(e) => onChange({ ai_lead_exclusions: e.target.value })}
                rows={4}
                maxLength={4000}
                placeholder={
                  "e.g. People asking about jobs or internships.\nOther businesses trying to sell us something.\nStudents asking for project help."
                }
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] leading-relaxed text-slate-800 outline-none transition-colors focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
              />
            </label>
          </section>

          {/* ── How sure it has to be ── */}
          <section>
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
              <Gauge className="h-3.5 w-3.5 text-slate-400" />
              How sure it has to be
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(Object.keys(THRESHOLD_LABELS) as LeadThreshold[]).map((key) => {
                const active = values.ai_lead_threshold === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChange({ ai_lead_threshold: key })}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-violet-300 bg-violet-50/70 ring-1 ring-violet-200"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`block text-[12.5px] font-semibold ${
                        active ? "text-violet-900" : "text-slate-700"
                      }`}
                    >
                      {THRESHOLD_LABELS[key].label}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-slate-500">
                      {THRESHOLD_LABELS[key].hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Suggest or create ── */}
          <section>
            <p className="text-[13px] font-semibold text-slate-800">
              What it does when it finds one
            </p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Only when there is no lead for that person yet. If Auto Lead Creation above already
              made one, the assistant marks that lead instead.
            </p>
            <div className="mt-2 space-y-2">
              <ModeOption
                active={values.ai_lead_mode !== "create"}
                onClick={() => onChange({ ai_lead_mode: "suggest" })}
                title="Suggest it, and let somebody accept"
                body="It lands on the Suggested tab with the reason it gave. Nothing enters the lead pool until a person says yes. Start here."
              />
              <ModeOption
                active={values.ai_lead_mode === "create"}
                onClick={() => onChange({ ai_lead_mode: "create" })}
                title="Create the lead straight away"
                body="It goes into New Leads like any other. Worth switching to once the accuracy below is high enough that reviewing them is busywork."
              />
            </div>

            {/* The account's own number. Shown here because this is the
                screen where the decision above gets made. */}
            {accuracy && accuracy.reviewed > 0 && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <p className="text-[11.5px] leading-relaxed text-slate-600">
                  {accuracy.reviewed >= MIN_REVIEWS_FOR_A_PERCENTAGE ? (
                    <>
                      Of the {accuracy.reviewed} suggestions your team has reviewed,{" "}
                      <strong className="text-slate-800">
                        {accuracy.percent}% were accepted
                      </strong>
                      .
                    </>
                  ) : (
                    <>
                      {accuracy.accepted} of {accuracy.reviewed} reviewed so far. A percentage will
                      appear here once there are {MIN_REVIEWS_FOR_A_PERCENTAGE} — fewer than that
                      and the number moves around too much to mean anything.
                    </>
                  )}
                  {accuracy.pending > 0 && ` ${accuracy.pending} still waiting on the Suggested tab.`}
                </p>
              </div>
            )}
          </section>

          {/* ── When it bothers ── */}
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-medium text-slate-600">
                Wait until the customer has sent{" "}
                <span className="text-slate-400">
                  {values.ai_lead_min_messages} message
                  {values.ai_lead_min_messages === 1 ? "" : "s"}
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={values.ai_lead_min_messages}
                onChange={(e) =>
                  onChange({ ai_lead_min_messages: Math.max(1, Number(e.target.value) || 1) })
                }
                className="mt-1.5 h-9 w-full rounded-xl border border-slate-200 px-3 text-[13px] tabular-nums outline-none focus:border-violet-400"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                One &ldquo;hi&rdquo; is not a conversation. Nothing is judged before this.
              </span>
            </label>

            <label className="block">
              <span className="text-[12px] font-medium text-slate-600">
                Do not look at the same chat again for{" "}
                <span className="text-slate-400">
                  {values.ai_lead_recheck_hours === 0
                    ? "— checks every time"
                    : `${values.ai_lead_recheck_hours}h`}
                </span>
              </span>
              <input
                type="number"
                min={0}
                max={720}
                value={values.ai_lead_recheck_hours}
                onChange={(e) =>
                  onChange({ ai_lead_recheck_hours: Math.max(0, Number(e.target.value) || 0) })
                }
                className="mt-1.5 h-9 w-full rounded-xl border border-slate-200 px-3 text-[13px] tabular-nums outline-none focus:border-violet-400"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Stops a long conversation being charged for on every message.
              </span>
            </label>
          </section>
        </div>
      )}
    </div>
  )
}

function ModeOption({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean
  onClick: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
        active ? "border-violet-300 bg-violet-50/70" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          active ? "border-violet-600" : "border-slate-300"
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-violet-600" />}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[12.5px] font-semibold ${active ? "text-violet-900" : "text-slate-700"}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{body}</span>
      </span>
    </button>
  )
}
