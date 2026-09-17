"use client"

/**
 * What is actually running, shown where you already are.
 *
 * Twice now a deploy has gone `git pull` then `pm2 restart`, with no
 * build in between. Next serves the compiled output in `.next`, so the
 * restart faithfully relaunches the old code — the commit is new, the
 * process is new, the behaviour is old, and nothing anywhere says so.
 * The next hour goes into re-debugging something that was already fixed.
 *
 * So the one comparison that matters gets a permanent home: the commit
 * on disk against the time the build was made. Quiet and grey when they
 * agree; amber and unmissable when they do not, because in that state
 * every other thing on this screen is lying about what it does.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, Check, Loader2 } from "lucide-react"

interface Version {
  commit: string | null
  branch: string | null
  pulledAt: string | null
  builtAt: string | null
  startedAt: string | null
  stale: boolean
  nodeEnv: string
}

function ago(iso: string | null): string {
  if (!iso) return "unknown"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return "just now"
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function BuildBadge() {
  const [v, setV] = useState<Version | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then(setV)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return null

  if (!v) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking build…
      </div>
    )
  }

  if (v.stale) {
    return (
      <div className="rounded-lg bg-amber-50 px-2.5 py-2 ring-1 ring-amber-500/20">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Running an old build
        </p>
        <p className="mt-1 text-[10.5px] leading-relaxed text-amber-800">
          Code was pulled {ago(v.pulledAt)} but the last build was {ago(v.builtAt)}. Nothing on
          this screen reflects the newer code until you run{" "}
          <code className="rounded bg-white/70 px-1">npm run build</code> and restart.
        </p>
      </div>
    )
  }

  return (
    <div className="px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
        <span className="font-mono">{v.commit ?? "unknown"}</span>
        {v.branch && v.branch !== "master" && (
          <span className="truncate text-slate-400">· {v.branch}</span>
        )}
      </p>
      <p className="mt-0.5 pl-[18px] text-[10px] leading-relaxed text-slate-400">
        Built {ago(v.builtAt)} · running {ago(v.startedAt)}
      </p>
    </div>
  )
}
