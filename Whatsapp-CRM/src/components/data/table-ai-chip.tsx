"use client"

/**
 * Whether the assistant answers from this table, and whether what it
 * knows is current — with "Train now" right here instead of three
 * screens away on the Training tab.
 *
 * Training is the only part of the Data Store that needs AI. Everything
 * else on this page works without it.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Bot, BrainCircuit, Loader2, Lock, RefreshCw, Sparkles } from "lucide-react"

interface AiState {
  ai: { configured: boolean; knowledge_enabled: boolean; semantic: boolean; auto_reply: boolean }
  knowledge: {
    id: string
    status: string
    audience: string
    last_synced_at: string | null
    last_error: string | null
  } | null
  can_register: boolean
  personal_data: boolean
  can_manage: boolean
}

function ago(iso: string | null): string {
  if (!iso) return "never"
  const mins = Math.round((Date.parse(iso) - Date.parse(new Date().toISOString())) / -60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function chip(state: AiState | null): { label: string; className: string } {
  if (!state) return { label: "AI", className: "border-slate-200 text-slate-400" }
  if (!state.ai.configured) return { label: "AI off", className: "border-slate-200 text-slate-500" }
  if (!state.knowledge) return { label: "Not in AI", className: "border-dashed border-slate-300 text-slate-500" }
  switch (state.knowledge.status) {
    case "trained":
      return { label: "AI trained", className: "border-emerald-200 bg-emerald-50 text-emerald-700" }
    case "failed":
      return { label: "AI: failed", className: "border-rose-200 bg-rose-50 text-rose-700" }
    case "disabled":
      return { label: "AI: paused", className: "border-slate-200 text-slate-500" }
    default:
      return { label: "AI: needs training", className: "border-amber-200 bg-amber-50 text-amber-800" }
  }
}

export function TableAiChip({ tableId }: { tableId: string }) {
  const [state, setState] = useState<AiState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [audience, setAudience] = useState<"customer" | "internal">("internal")

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/data-tables/${tableId}/ai`, { cache: "no-store" })
      if (res.ok) setState(await res.json())
    } catch {
      // The chip stays neutral; nothing else on the page depends on it.
    }
  }, [tableId])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: "connect" | "train") {
    setBusy(true)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, audience }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not train")
      setState(data)
      toast.success(data.message || "Done")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not train")
    } finally {
      setBusy(false)
    }
  }

  const look = chip(state)
  const k = state?.knowledge

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors hover:brightness-95 ${look.className}`}
        title="AI knowledge for this table"
      >
        <Bot className="h-3.5 w-3.5" />
        {look.label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold text-slate-900">AI knowledge</h3>
            </div>

            {!state ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            ) : !state.ai.configured ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-slate-600">
                AI is not set up for this account, so nothing here is used by an assistant. The Data Store works fully
                without it.{" "}
                {state.can_manage && (
                  <a href="/settings?tab=ai" className="font-medium text-primary hover:underline">
                    Set up AI
                  </a>
                )}
              </p>
            ) : !k ? (
              <div className="mt-2 flex flex-col gap-3">
                <p className="text-[12.5px] leading-relaxed text-slate-600">
                  The assistant does not read this table yet. Connect it and it can answer from these rows — a price
                  list, courses, branches, timings.
                </p>
                {state.personal_data ? (
                  <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This table holds people&apos;s details, so it is connected for staff questions only — the assistant
                    will never read one customer&apos;s details out to another. Aadhaar, PAN and passwords are never read at all.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 text-[12.5px] text-slate-700">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="ai-audience" checked={audience === "customer"} onChange={() => setAudience("customer")} className="accent-[var(--primary)]" />
                      Customers can be told this
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="ai-audience" checked={audience === "internal"} onChange={() => setAudience("internal")} className="accent-[var(--primary)]" />
                      Staff only
                    </label>
                  </div>
                )}
                {state.can_manage ? (
                  <button
                    onClick={() => run("connect")}
                    disabled={busy}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Connect &amp; train
                  </button>
                ) : (
                  <p className="text-[12px] text-slate-400">Only an admin can connect a table to the AI.</p>
                )}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                  <dt className="text-slate-400">Status</dt>
                  <dd className="font-medium text-slate-800">{look.label.replace(/^AI:?\s*/, "") || "—"}</dd>
                  <dt className="text-slate-400">Rows read</dt>
                  <dd className="text-slate-700">{ago(k.last_synced_at)}</dd>
                  <dt className="text-slate-400">Answers</dt>
                  <dd className="text-slate-700">{k.audience === "customer" ? "Customers and staff" : k.audience === "both" ? "Customers and staff" : "Staff only"}</dd>
                  <dt className="text-slate-400">Search</dt>
                  <dd className="text-slate-700">{state.ai.semantic ? "By meaning" : "By keyword (add a Gemini key for meaning)"}</dd>
                </dl>
                {k.last_error && (
                  <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{k.last_error}</p>
                )}
                {!state.ai.knowledge_enabled && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    The knowledge base is switched off in AI Config.
                  </p>
                )}
                {state.can_manage ? (
                  <button
                    onClick={() => run("train")}
                    disabled={busy}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Train now
                  </button>
                ) : (
                  <p className="text-[12px] text-slate-400">Only an admin can train.</p>
                )}
                <p className="text-[11.5px] leading-relaxed text-slate-400">
                  Re-reads the rows and trains straight away. It also catches up by itself within the hour.
                </p>
              </div>
            )}

            {state?.can_register && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] text-slate-500">
                Customers can also <span className="font-medium text-slate-700">register into this table</span> on
                WhatsApp — set in Fields.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
