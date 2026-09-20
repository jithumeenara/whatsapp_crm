"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Megaphone, MousePointerClick, FileSpreadsheet, LineChart, Link2, Clock,
  Loader2, AlertTriangle, IndianRupee, MousePointer, ArrowUpRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const META_BLUE = "#0866FF"
const META_BLUE_SOFT = "#EAF2FF"

interface DashboardData {
  connected: boolean
  dataset_ready?: boolean
  insights?: { spend: number; impressions: number; clicks: number; cpc: number | null; cpm: number | null } | null
  insights_error?: string | null
  attributed_conversations?: number
  lead_ads_captured?: number
  qualified_from_ads?: number
  cost_per_lead?: number | null
  recent_leads?: Array<{
    id: string
    created_at: string
    form_name: string
    lead_id: string | null
    contact_name: string | null
    contact_phone: string | null
    status: string | null
    lead_quality: string | null
  }>
}

const STATUS_LABEL: Record<string, string> = {
  new: "New", open: "Open", call_not_connected: "Not Connected", visited: "Visited",
  appointment_fixed: "Appt Fixed", follow_up: "Follow-up", closed: "Closed",
}

function fmtNumber(n: number) { return n.toLocaleString('en-IN') }
function fmtCurrency(n: number) { return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` }

/**
 * Ads dashboard — the day-to-day home for campaign performance, the way
 * /inbox is the day-to-day home for conversations while the actual
 * connection lives in Settings → Ads. Every number here is real: ad
 * spend/clicks come from Meta's own Ads Insights API, attribution counts
 * come straight from this CRM's own database (conversations with a
 * stored ctwa_clid, real Lead Ads submissions) — never a placeholder
 * figure standing in as if it were this account's own data.
 */
export default function AdsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/meta-ads/dashboard')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData({ connected: false }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const connected = data?.connected ?? false

  return (
    <div className="min-h-full p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
          <Megaphone className="h-5 w-5" style={{ color: META_BLUE }} />
        </div>
        <div>
          <h1 className="text-[20px] font-bold text-slate-900">Ads</h1>
          <p className="text-[12px] text-slate-500">Track Meta and Google ad performance without leaving this CRM</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: META_BLUE }} />
        </div>
      ) : connected ? (
        <div className="space-y-6">
          {/* Real stat row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={MousePointerClick} label="Ad-attributed conversations" value={fmtNumber(data?.attributed_conversations ?? 0)}
              hint="WhatsApp chats that started from a Click-to-WhatsApp ad" />
            <StatCard icon={FileSpreadsheet} label="Lead Ads captured" value={fmtNumber(data?.lead_ads_captured ?? 0)}
              hint="Instant Form submissions synced into Leads" />
            <StatCard icon={LineChart} label="Qualified from ads" value={fmtNumber(data?.qualified_from_ads ?? 0)}
              hint="Leads marked Qualified with an ad behind them" />
            {data?.insights ? (
              <StatCard icon={IndianRupee} label="Cost per lead" value={data.cost_per_lead != null ? fmtCurrency(data.cost_per_lead) : '—'}
                hint={`${fmtCurrency(data.insights.spend)} spent, last 30 days`} />
            ) : (
              <StatCard icon={IndianRupee} label="Cost per lead" value="—"
                hint={data?.insights_error ?? 'Add an Ad Account ID in Ads settings to see spend'} />
            )}
          </div>

          {data?.insights && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-[14px] font-semibold text-slate-800">Last 30 days — Meta Ads Insights</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">Pulled live from your connected ad account.</p>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric icon={IndianRupee} label="Spend" value={fmtCurrency(data.insights.spend)} />
                <Metric icon={MousePointer} label="Clicks" value={fmtNumber(data.insights.clicks)} />
                <Metric label="Impressions" value={fmtNumber(data.insights.impressions)} />
                <Metric label="CPC" value={data.insights.cpc != null ? fmtCurrency(data.insights.cpc) : '—'} />
              </div>
            </div>
          )}

          {!!data?.recent_leads?.length && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-[14px] font-semibold text-slate-800">Recent leads from your ads</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">The real people behind the numbers above — not just a count.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {data.recent_leads.map((lead) => (
                  <a
                    key={lead.id}
                    href={lead.lead_id ? `/leads/${lead.lead_id}` : undefined}
                    className="flex items-center gap-3 px-6 py-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: META_BLUE_SOFT }}>
                      <FileSpreadsheet className="h-3.5 w-3.5" style={{ color: META_BLUE }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{lead.contact_name || lead.contact_phone || "Unknown contact"}</p>
                      <p className="text-[11.5px] text-slate-400 truncate">{lead.form_name} · {new Date(lead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    {lead.status && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        {STATUS_LABEL[lead.status] ?? lead.status}
                      </span>
                    )}
                    {lead.lead_id && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
                  </a>
                ))}
              </div>
            </div>
          )}

          {!data?.dataset_ready && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Conversions API dataset not ready</p>
                <p className="text-[12px] text-amber-700 mt-0.5">
                  Attribution counts above are real, but outcomes aren&apos;t being reported back to Meta yet. Check Ads settings.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Preview stat row — dashes, not fake numbers, until connected */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={MousePointerClick} label="Ad-attributed conversations" value="—" hint="Connect Meta Ads to see this" muted />
            <StatCard icon={FileSpreadsheet} label="Lead Ads captured" value="—" hint="Synced automatically once connected" muted />
            <StatCard icon={LineChart} label="Cost per lead" value="—" hint="Calculated from real ad spend" muted />
          </div>

          {/* Connect card */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EAF2FF] via-[#F3F7FF] to-[#EFF6FF] px-7 py-10">
            <div className="flex flex-col items-center gap-5 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-black/5" style={{ color: META_BLUE }}>
                <Megaphone className="h-7 w-7" />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "#fff", color: META_BLUE }}>
                <Clock className="h-3 w-3" />
                Not connected yet
              </span>
              <div>
                <h2 className="text-[18px] font-bold text-slate-900">No ad account connected yet</h2>
                <p className="mt-1.5 max-w-md text-[13px] text-slate-500">
                  Once connected, every ad-originated WhatsApp conversation, every Lead Ads submission, and
                  real cost-per-result will show up here automatically — no manual reporting.
                </p>
              </div>
              <Button type="button" onClick={() => router.push("/settings?tab=ads")} className="h-10 px-5 text-[13px] font-semibold text-white" style={{ background: META_BLUE }}>
                <Link2 className="h-4 w-4" />
                Go to Ads settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, hint, muted }: {
  icon: React.ElementType; label: string; value: string; hint: string; muted?: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: muted ? '#F1F5F9' : META_BLUE_SOFT }}>
        <Icon className="h-4 w-4" style={{ color: muted ? '#94A3B8' : META_BLUE }} />
      </span>
      <p className={`mt-3 text-[22px] font-bold ${muted ? 'text-slate-300' : 'text-slate-900'}`}>{value}</p>
      <p className="text-[12.5px] font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="mt-0.5 text-[16px] font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  )
}
