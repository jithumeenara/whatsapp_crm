"use client"

/**
 * The switch for "answer messages no chatbot claimed".
 *
 * It belongs on the chatbot page rather than buried in AI settings,
 * because it answers the question this page raises. Somebody looking at
 * a list of keyword-triggered bots is looking at a list of the phrasings
 * they thought of — and the obvious next thought is "what happens to
 * everything else?". Until now the answer was "nothing", and it was
 * nowhere on screen.
 *
 * Deliberately states the guards rather than hiding them behind an
 * innocuous toggle. This is the assistant talking to real customers with
 * no flow around it, and somebody switching it on should know what stops
 * it before they find out the hard way.
 */

import { useCallback, useEffect, useState } from "react"
import { Sparkles, Loader2, ChevronDown, AlertTriangle } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

type Config = {
  enabled: boolean
  maxTurns: number
  pauseOnAgent: boolean
  /** Close a chat the customer has walked away from. */
  idleClose: boolean
  /** How long the silence must last, in minutes. */
  idleAfter: number
  /** No assistant configured at all — the toggle would do nothing. */
  configured: boolean
  hasPrompt: boolean
  knowledgeCount: number | null
}

/** Written the way somebody thinks about it, not in minutes. The range
 *  spans a shop wanting half an hour and an institute taking admissions
 *  wanting a couple of days. */
const IDLE_CHOICES = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 180, label: "3 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "1 day" },
  { minutes: 2880, label: "2 days" },
  { minutes: 10080, label: "1 week" },
]

export function AiFallbackBanner() {
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [aiRes, knowledgeRes] = await Promise.all([
          fetch("/api/ai-config"),
          fetch("/api/ai-knowledge?limit=1"),
        ])
        if (!aiRes.ok || cancelled) return
        const data = await aiRes.json()
        let knowledgeCount: number | null = null
        if (knowledgeRes.ok) {
          const k = await knowledgeRes.json()
          knowledgeCount = typeof k.total === "number" ? k.total : (k.items?.length ?? null)
        }
        if (cancelled) return
        setConfig({
          enabled: !!data.ai_auto_reply_enabled,
          maxTurns: data.ai_auto_reply_max_turns ?? 8,
          pauseOnAgent: data.ai_auto_reply_pause_on_agent !== false,
          idleClose: !!data.idle_close_enabled,
          idleAfter: data.idle_close_after_minutes ?? 1440,
          configured: Boolean(data.active_provider && data.provider_keys?.gemini?.has_key),
          hasPrompt: Boolean(data.system_prompt?.trim()),
          knowledgeCount,
        })
      } catch {
        /* the page works without this card */
      }
    })()
    return () => { cancelled = true }
  }, [])

  const save = useCallback(
    async (
      patch: Partial<Pick<Config, "enabled" | "maxTurns" | "pauseOnAgent" | "idleClose" | "idleAfter">>,
    ) => {
      if (!config || saving) return
      const next = { ...config, ...patch }
      setConfig(next)
      setSaving(true)
      try {
        // PUT, not POST: this route exports GET, PUT and DELETE only.
        // A POST returned 405 with an empty body, and reading .json() on
        // that threw "Unexpected end of JSON input" — which is what the
        // user saw instead of anything about the method.
        const res = await fetch("/api/ai-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ai_auto_reply_enabled: next.enabled,
            ai_auto_reply_max_turns: next.maxTurns,
            ai_auto_reply_pause_on_agent: next.pauseOnAgent,
            idle_close_enabled: next.idleClose,
            idle_close_after_minutes: next.idleAfter,
          }),
        })
        if (!res.ok) {
          // Parsed defensively. An error response is not guaranteed to
          // carry JSON — 405 and 502 both arrive empty — and letting the
          // parse throw replaces a real status with a parser complaint.
          const detail = await res.json().catch(() => null)
          throw new Error(detail?.error ?? `Could not save (${res.status})`)
        }
        if (patch.enabled !== undefined) {
          toast.success(
            patch.enabled
              ? "The assistant will now answer messages no chatbot claimed."
              : "Unmatched messages will wait in the inbox again.",
          )
        }
      } catch (err) {
        // Put the old value back: a switch that looks on while the
        // server thinks it is off is worse than a failed save.
        setConfig(config)
        toast.error(err instanceof Error ? err.message : "Could not save")
      } finally {
        setSaving(false)
      }
    },
    [config, saving],
  )

  if (!config) return null

  const emptyKnowledge = config.knowledgeCount !== null && config.knowledgeCount === 0

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/80 to-purple-50/50">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm">
          <Sparkles className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900">
            Answer messages no chatbot matched
          </p>
          <p className="text-[11.5px] leading-relaxed text-slate-600">
            Your bots start on keywords. When a customer writes something none of them expected, the assistant
            replies from your knowledge base instead of leaving it in the inbox.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          <Switch
            checked={config.enabled}
            disabled={!config.configured || saving}
            onCheckedChange={(v) => void save({ enabled: v })}
          />
        </div>
      </div>

      {!config.configured && (
        <p className="border-t border-indigo-200/60 bg-white/60 px-4 py-2 text-[11.5px] text-slate-600">
          Set up the AI assistant in Settings &rarr; AI Config first — there is nothing to answer with yet.
        </p>
      )}

      {config.configured && config.enabled && (
        <div className="border-t border-indigo-200/60 bg-white/60">
          {(emptyKnowledge || !config.hasPrompt) && (
            <div className="flex items-start gap-2 px-4 py-2.5 text-[11.5px] leading-relaxed text-amber-800">
              <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
              <span>
                {emptyKnowledge && (
                  <span className="block">
                    Your knowledge base is empty, so replies will come from the prompt alone — it will mostly
                    have to hand over.
                  </span>
                )}
                {!config.hasPrompt && (
                  <span className="block">
                    No customer prompt is set, so replies fall back to a generic assistant.
                  </span>
                )}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50/60"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            What stops it
          </button>

          {expanded && (
            <div className="space-y-3 px-4 pb-3.5">
              <ul className="space-y-1 text-[11.5px] leading-relaxed text-slate-600">
                <li>• A chatbot or automation that matches always wins — it only answers what nothing claimed.</li>
                <li>
                  • It stays out of any conversation assigned to a person — unassign it to let the assistant
                  answer there again.
                </li>
                <li>• It hands over when the knowledge base has no confident answer.</li>
                <li>• It hands over rather than send a price, date or number it cannot verify.</li>
                <li>• Refunds, complaints, another customer&apos;s details and requests for a person go straight to your team.</li>
              </ul>

              <div className="flex flex-wrap items-center gap-4 border-t border-slate-200/70 pt-3">
                {/* The cap, and the switch that removes it.
                    Two controls rather than a box you type 0 into,
                    because "stop after 0 replies" reads as the opposite
                    of what it does. */}
                <div className="flex items-center gap-2 text-[11.5px] text-slate-700">
                  <Switch
                    checked={config.maxTurns > 0}
                    onCheckedChange={(v) => void save({ maxTurns: v ? 8 : 0 })}
                  />
                  {config.maxTurns > 0 ? (
                    <label className="flex items-center gap-2" htmlFor="ai-max-turns">
                      <span>Stop after</span>
                      <input
                        id="ai-max-turns"
                        type="number"
                        min={1}
                        max={50}
                        value={config.maxTurns}
                        onChange={(e) => setConfig({ ...config, maxTurns: Number(e.target.value) })}
                        onBlur={() =>
                          void save({ maxTurns: Math.min(50, Math.max(1, config.maxTurns || 8)) })
                        }
                        className="h-7 w-14 rounded-lg border border-slate-200 bg-white px-2 text-center text-[12px] tabular-nums outline-none focus:border-indigo-400"
                      />
                      <span>replies in one chat</span>
                    </label>
                  ) : (
                    <span>
                      No reply limit —{" "}
                      <span className="text-amber-700">
                        it keeps answering until someone here replies
                      </span>
                    </span>
                  )}
                </div>

                <label
                  className="flex items-center gap-2 text-[11.5px] text-slate-700"
                  title="Assignment is what counts. A conversation marked Pending that nobody has picked up still gets answered."
                >
                  <Switch
                    checked={config.pauseOnAgent}
                    onCheckedChange={(v) => void save({ pauseOnAgent: v })}
                  />
                  <span>Stop once a person takes over</span>
                </label>

                {/* Tidying the Inbox, not answering anybody — so it gets
                    its own row and its own sentence about what it will
                    not touch. The exclusions are the part somebody
                    switching this on actually needs to trust. */}
                <div className="flex w-full flex-col gap-1 border-t border-slate-200/70 pt-3">
                  <div className="flex items-center gap-2 text-[11.5px] text-slate-700">
                    <Switch
                      checked={config.idleClose}
                      onCheckedChange={(v) => void save({ idleClose: v })}
                    />
                    {config.idleClose ? (
                      <label className="flex items-center gap-2" htmlFor="ai-idle-after">
                        <span>Close the chat after</span>
                        <select
                          id="ai-idle-after"
                          value={config.idleAfter}
                          onChange={(e) => void save({ idleAfter: Number(e.target.value) })}
                          className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-indigo-400"
                        >
                          {IDLE_CHOICES.map((c) => (
                            <option key={c.minutes} value={c.minutes}>{c.label}</option>
                          ))}
                        </select>
                        <span>with no reply</span>
                      </label>
                    ) : (
                      <span>Never close a chat on its own</span>
                    )}
                  </div>
                  {config.idleClose && (
                    <p className="pl-[46px] text-[11px] leading-relaxed text-slate-500">
                      Only chats nobody is handling, where we sent the last message. A chat waiting
                      on your team, or assigned to someone, is never closed — and it reopens on its
                      own if the customer writes again.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
