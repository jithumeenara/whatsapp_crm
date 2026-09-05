"use client"

import { useRouter } from "next/navigation"
import {
  Megaphone, MousePointerClick, FileSpreadsheet, LineChart, Link2, Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const META_BLUE = "#0866FF"
const META_BLUE_SOFT = "#EAF2FF"

const PREVIEW_CARDS = [
  { icon: MousePointerClick, label: "Ad-attributed conversations", value: "—", hint: "Connect Meta Ads to see this" },
  { icon: FileSpreadsheet,   label: "Lead Ads captured",           value: "—", hint: "Synced automatically once connected" },
  { icon: LineChart,         label: "Cost per qualified lead",     value: "—", hint: "Calculated from real pipeline outcomes" },
]

/**
 * Ads dashboard — the day-to-day home for campaign performance, the way
 * /inbox is the day-to-day home for conversations while the actual
 * connection lives in Settings → Ads. No backend exists yet (Meta App
 * Review + the Conversions API work is still ahead), so this renders an
 * honest "not connected" state with a real preview of what the numbers
 * will look like — never fabricated figures standing in as if they were
 * this account's own data.
 */
export default function AdsPage() {
  const router = useRouter()

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

      {/* Preview stat row — dashes, not fake numbers, until a real account is connected */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PREVIEW_CARDS.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                <c.icon className="h-4 w-4 text-slate-400" />
              </span>
            </div>
            <p className="mt-3 text-[22px] font-bold text-slate-300">{c.value}</p>
            <p className="text-[12.5px] font-medium text-slate-600">{c.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{c.hint}</p>
          </div>
        ))}
      </div>

      {/* Connect card */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EAF2FF] via-[#F3F7FF] to-[#EFF6FF] px-7 py-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-black/5"
            style={{ color: META_BLUE }}
          >
            <Megaphone className="h-7 w-7" />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "#fff", color: META_BLUE }}>
            <Clock className="h-3 w-3" />
            Meta Ads — in development
          </span>
          <div>
            <h2 className="text-[18px] font-bold text-slate-900">No ad account connected yet</h2>
            <p className="mt-1.5 max-w-md text-[13px] text-slate-500">
              Once connected, every ad-originated WhatsApp conversation, every Lead Ads submission, and
              real cost-per-result will show up here automatically — no manual reporting.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => router.push("/settings?tab=ads")}
            className="h-10 px-5 text-[13px] font-semibold text-white"
            style={{ background: META_BLUE }}
          >
            <Link2 className="h-4 w-4" />
            Go to Ads settings
          </Button>
        </div>
      </div>
    </div>
  )
}
