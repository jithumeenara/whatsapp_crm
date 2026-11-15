"use client"

/**
 * Settings → Reports: the Performance guide's AI suggestions switch
 * (plan §8: off by default). Saved on its own, so it never touches the
 * other report settings; the switch shows "on" only after the server
 * confirms.
 */

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Sparkles } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { apiFetch, errorText } from "@/lib/api-fetch"

export function AiGuideSetting() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    let alive = true
    apiFetch("/api/reports/settings")
      .then((r) => r.json())
      .then((b: { guide?: { aiGuide?: boolean } }) => { if (alive) setOn(b?.guide?.aiGuide === true) })
      .catch((err) => { console.error("[ai-guide] load failed", err); if (alive) setOn(false) })
    return () => { alive = false }
  }, [])

  async function toggle(next: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await apiFetch("/api/reports/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guide: { aiGuide: next } }) })
      const b = (await res.json()) as { guide?: { aiGuide?: boolean } }
      setOn(b?.guide?.aiGuide === true)
      toast.success(next ? "AI suggestions are on." : "AI suggestions are off.")
    } catch (err) {
      console.error("[ai-guide] save failed", err)
      toast.error(errorText(err, "Could not save the setting."))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="ai-guide-title" className="rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600" aria-hidden><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="ai-guide-title" className="text-[15px] font-semibold text-slate-800">AI suggestions in the Performance guide</h2>
          <p className="mt-0.5 text-pretty text-[12.5px] text-slate-600">
            The AI explains the guide&apos;s own numbers and suggests a few steps, labelled &quot;AI&quot;. It is given only those numbers and team names, never customer details, and any line with a number that is not in the report is dropped. Uses your Gemini key (a small cost each time the numbers change).
          </p>
        </div>
        <Switch
          checked={on === true}
          disabled={on === null || busy}
          onCheckedChange={(v) => void toggle(v)}
          aria-label={on ? "Switch AI suggestions off" : "Switch AI suggestions on"}
        />
      </div>
    </section>
  )
}
