"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarClock, FileSpreadsheet, Trash2, Users, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { useRouter, useSearchParams } from "next/navigation"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { VerifyPeople } from "@/components/verify/verify-people"
import { VerifySettings, type VerificationSettings } from "@/components/verify/verify-settings"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { apiFetch, errorText } from "@/lib/api-fetch"

export default function VerifyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const { accountRole } = useAuth()
  const admin = hasMinRole(accountRole ?? "viewer", "admin")
  const [v, setV] = useState<VerificationSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"people" | "settings">(search.get("tab") === "settings" ? "settings" : "people")
  const [askDelete, setAskDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/sheet-verifications/${id}`, { cache: "no-store" })
      const d = (await res.json()) as { verification?: VerificationSettings & { deadline: string | null } }
      if (!d.verification) throw new Error("Not found.")
      setV({ ...d.verification, show_columns: d.verification.show_columns ?? [], edit_columns: d.verification.edit_columns ?? [], template_params: d.verification.template_params ?? [] })
    } catch (err) {
      console.error("[verify] load failed:", err)
      setError(errorText(err, "Could not load this check"))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function remove() {
    if (deleting) return
    setDeleting(true)
    try {
      await apiFetch(`/api/sheet-verifications/${id}`, { method: "DELETE" })
      toast.success("Deleted — its links no longer work. Your sheet is unchanged.")
      router.push("/data/verify")
    } catch (err) {
      console.error("[verify] delete failed:", err)
      toast.error(errorText(err, "Could not delete"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-[#F4F6FA]">
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <Link href="/data/verify" aria-label="Back to all checks" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0 flex-1 basis-56">
            {v ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="min-w-0 break-words text-[16px] font-semibold text-slate-900" dir="auto">{v.name}</h1>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${v.status === "closed" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>{v.status === "closed" ? "Closed" : "Open"}</span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-slate-500">
                  <span className="inline-flex min-w-0 items-center gap-1" dir="auto"><FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> <span className="truncate">{v.spreadsheet_name ?? "Google Sheet"} · {v.tab_title}</span></span>
                  {v.deadline && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Until {new Date(v.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
                </p>
              </>
            ) : (
              <h1 className="text-[16px] font-semibold text-slate-900">Check details</h1>
            )}
          </div>
          {admin && (
            <div className="flex items-center gap-1.5">
              <div role="tablist" aria-label="View" className="flex rounded-lg bg-slate-100 p-0.5">
                {(["people", "settings"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                    {t === "people" ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    {t === "people" ? "People" : "Settings"}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setAskDelete(true)} disabled={deleting} aria-label="Delete this check" title="Delete this check" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
        {v && (tab === "people" || !admin) && <VerifyPeople id={id} spreadsheetId={v.spreadsheet_id} />}
        {v && tab === "settings" && admin && <VerifySettings initial={{ ...v, id }} onSaved={() => { void load(); setTab("people") }} />}
      </div>

      <ConfirmDialog
        open={askDelete}
        title="Delete this check?"
        description="Every link sent for it stops working. Your Google Sheet, with its answers and corrections, is not touched."
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setAskDelete(false)}
        onConfirm={() => { setAskDelete(false); void remove() }}
      />
    </div>
  )
}
