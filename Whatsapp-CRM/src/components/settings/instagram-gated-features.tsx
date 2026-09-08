"use client"

import { useEffect, useState } from "react"
import { ShieldAlert, MessageSquareText, AtSign, ExternalLink, Loader2 } from "lucide-react"

interface StatusData { comment_dm_status: string }

/**
 * IG·01 (comment-to-DM) and IG·02 (story mentions) — both fully built end
 * to end (webhook parsing, Automations trigger wiring, DM-reply chain
 * reusing the same action infrastructure every other trigger uses), but
 * gated on a NEW Meta permission (instagram_business_manage_comments /
 * instagram_manage_mentions) this app cannot self-grant — it requires a
 * fresh App Review submission from this CRM's own Meta App, tracked
 * outside this codebase entirely. Never claims "Connected" — same honesty
 * standard as the UPI payments "pending_meta_approval" banner.
 */
export function InstagramGatedFeatures() {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string>("pending_meta_approval")

  useEffect(() => {
    fetch("/api/instagram/config")
      .then((r) => r.json())
      .then((d: StatusData & Record<string, unknown>) => {
        if (d && typeof d.comment_dm_status === "string") setStatus(d.comment_dm_status)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
          <ShieldAlert className="h-4.5 w-4.5 text-amber-600" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Comment-to-DM &amp; Story Mentions</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Requires Meta&apos;s explicit App Review approval — not self-serve.</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Fully built, but gated by Meta — not something this app can self-approve.</p>
            <p className="mt-1">
              Both features below are complete end-to-end (webhook parsing, keyword matching, and DM replies reuse
              the same Automations action chain every other trigger uses) and will start working automatically the
              moment Meta approves this app&apos;s request for the relevant permission. Nothing here can trigger or
              speed up that approval — it&apos;s tracked in this CRM&apos;s own Meta App developer account, outside this
              codebase.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <MessageSquareText className="h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Comment-to-DM automation</p>
              <p className="text-[11.5px] text-slate-400">Needs <code className="font-mono">instagram_business_manage_comments</code></p>
            </div>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
              {status === "approved" ? "Approved" : "Pending approval"}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <AtSign className="h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Story mentions</p>
              <p className="text-[11.5px] text-slate-400">Needs <code className="font-mono">instagram_manage_mentions</code></p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
            Pending approval
          </span>
        </div>

        <a
          href="https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11.5px] text-slate-400 hover:text-slate-600"
        >
          <ExternalLink className="h-3 w-3" />
          Instagram webhooks reference (comments, mentions fields)
        </a>
      </div>
    </div>
  )
}
