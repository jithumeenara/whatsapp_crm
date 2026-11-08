"use client"

import { Users } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { MaybeLink, Section } from "./shared"
import { followUpHref, formatMinutes } from "./view-model"

export function FollowUpsSection({ data, allowed }: { data: OwnerDashboard; allowed: string[] | null | undefined }) {
  const f = data.followUps
  const buckets = [
    { label: "Overdue", n: f.overdue, href: followUpHref("overdue", data.view), tone: f.overdue > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-700" },
    { label: "Due today", n: f.dueToday, href: followUpHref("today", data.view), tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
    { label: "Next 7 days", n: f.next7Days, href: followUpHref("next7", data.view), tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ]
  return (
    <Section title="Follow-ups" hint="Open the list behind each number">
      <ul className="grid list-none grid-cols-3 gap-2 p-0">
        {buckets.map((b) => (
          <li key={b.label} className="min-w-0">
            <MaybeLink href={b.href} allowed={allowed} className={cn("block h-full rounded-lg border p-3 hover:brightness-[0.98]", b.tone)}>
              <span className="block text-[24px] font-bold leading-none tabular-nums">{b.n.toLocaleString()}</span>
              <span className="mt-1 block break-words text-[12px] font-semibold">{b.label}</span>
            </MaybeLink>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function TeamSection({ data }: { data: OwnerDashboard }) {
  const team = data.team ?? []
  const worst = team.reduce<typeof team[number] | null>((w, r) => (r.overdueFollowUps > (w?.overdueFollowUps ?? 0) ? r : w), null)
  return (
    <Section title="Team" hint="Credit goes to the person who closed the lead">
      {team.length === 0 ? (
        <EmptyState icon={<Users />} title="No team activity yet" description="People appear here once leads are assigned to them." />
      ) : (
        <>
          {/* Phones: one card per person. From sm: a table. */}
          <ul className="list-none space-y-2 p-0 sm:hidden">
            {team.map((r) => (
              <li key={r.userId} className="rounded-lg border border-slate-200 p-3 text-[12.5px]">
                <p className="break-words text-[13px] font-semibold text-slate-900">{r.name || "No name"}</p>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                  <div><dt className="inline">Leads </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.leads}</dd></div>
                  <div><dt className="inline">Won </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.won}</dd></div>
                  <div><dt className="inline">Calls </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.calls} ({r.connected} reached)</dd></div>
                  <div><dt className="inline">Overdue </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.overdueFollowUps}</dd></div>
                  <div className="col-span-2"><dt className="inline">First reply </dt><dd className="inline font-semibold tabular-nums text-slate-900">{formatMinutes(r.medianFirstReplyMinutes)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th scope="col" className="pb-2 font-semibold">Agent</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Leads</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Calls</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Won</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Overdue</th>
                  <th scope="col" className="pb-2 text-right font-semibold">First reply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {team.map((r) => (
                  <tr key={r.userId} className="text-slate-700">
                    <th scope="row" className="max-w-[10rem] break-words py-2 pr-2 font-medium text-slate-900">{r.name || "No name"}</th>
                    <td className="py-2 text-right tabular-nums">{r.leads}</td>
                    <td className="py-2 text-right tabular-nums">{r.calls} <span className="text-[11px] text-slate-500">({r.connected} reached)</span></td>
                    <td className="py-2 text-right tabular-nums">{r.won}</td>
                    <td className="py-2 text-right tabular-nums">{r.overdueFollowUps}</td>
                    <td className="py-2 text-right tabular-nums">{formatMinutes(r.medianFirstReplyMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {worst && worst.overdueFollowUps > 0 ? (
            <p className="mt-3 break-words rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
              {worst.name || "Someone"} has the most overdue follow-ups: {worst.overdueFollowUps}.
            </p>
          ) : null}
        </>
      )}
    </Section>
  )
}
