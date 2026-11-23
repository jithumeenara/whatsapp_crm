"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, Settings2 } from "lucide-react"
import { AdsOverview } from "@/components/ads/ads-overview"

interface DashboardData {
  connected: boolean
  dataset_ready?: boolean
  recent_leads?: Array<{
    id: string
    created_at: string
    form_name: string
    lead_id: string | null
    contact_name: string | null
    contact_phone: string | null
    status: string | null
  }>
}

const STATUS_LABEL: Record<string, string> = {
  new: "New", open: "Open", call_not_connected: "Not connected", visited: "Visited",
  appointment_fixed: "Appointment fixed", follow_up: "Follow-up", closed: "Closed",
}
const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" })

/**
 * Ads — the day-to-day home for ad results (the connections live in
 * Settings → Ads). Four headline numbers and a quiet list of campaigns and
 * ads; each opens a profile with the details (src/components/ads/ads-overview.tsx).
 * Every number is real: spend and delivery from Meta's insights, leads,
 * qualified and won from this CRM.
 */
export default function AdsPage() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/meta-ads/dashboard")
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((d: DashboardData) => { if (!cancelled) setData(d) })
      .catch((err) => { console.error("[ads] dashboard failed:", err); if (!cancelled) setData({ connected: false }) })
    return () => { cancelled = true }
  }, [])

  const leads = Array.isArray(data?.recent_leads) ? data.recent_leads : []

  return (
    <div className="mx-auto min-h-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-slate-900">Ads</h1>
          <p className="text-[12.5px] text-slate-500">What each ad cost, who it brought and who bought.</p>
        </div>
        <Link href="/settings?tab=ads" aria-label="Ads settings" title="Ads settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      {data && !data.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-[13px] text-slate-700">No ad account connected yet. Connect one to see spend, cost per lead and cost per sale here.</p>
          <Link href="/settings?tab=ads" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90">Connect ads</Link>
        </div>
      )}

      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" aria-label="Loading ad results" />}>
        <AdsOverview />
      </Suspense>

      {leads.length > 0 && (
        <section aria-labelledby="recent-ad-leads" className="rounded-2xl border border-slate-200 bg-white">
          <h2 id="recent-ad-leads" className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-800">Latest leads from ad forms</h2>
          <ul className="divide-y divide-slate-100">
            {leads.slice(0, 8).map((lead) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-800">{lead.contact_name || lead.contact_phone || "Unknown contact"}</span>
                    <span className="block truncate text-[11.5px] text-slate-500">{lead.form_name} · {day.format(new Date(lead.created_at))}</span>
                  </span>
                  {lead.status && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{STATUS_LABEL[lead.status] ?? lead.status}</span>}
                  {lead.lead_id && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
                </>
              )
              return (
                <li key={lead.id}>
                  {lead.lead_id
                    ? <Link href={`/leads/${lead.lead_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">{body}</Link>
                    : <div className="flex items-center gap-3 px-4 py-3">{body}</div>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {data?.connected && data.dataset_ready === false && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Results are not being sent back to Meta yet — check Settings → Ads.
        </p>
      )}
    </div>
  )
}
