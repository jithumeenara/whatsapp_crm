"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { VerifyPeople } from "@/components/verify/verify-people"
import { VerifySettings, type VerificationSettings } from "@/components/verify/verify-settings"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { apiFetch, errorText } from "@/lib/api-fetch"

export default function VerifyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { accountRole } = useAuth()
  const admin = hasMinRole(accountRole ?? "viewer", "admin")
  const [v, setV] = useState<VerificationSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"people" | "settings">("people")
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
    <div className="flex h-full flex-col overflow-y-auto bg-[#F4F6FA]">
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-h-14 flex-wrap items-center gap-2.5 py-2">
          <Link href="/data/verify" aria-label="Back" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">{v?.name ?? "Check details"}</h1>
          {admin && (
            <>
              <div role="tablist" aria-label="View" className="flex rounded-lg bg-slate-100 p-0.5">
                {(["people", "settings"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-8 rounded-md px-3 text-[13px] font-medium ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
                    {t === "people" ? "People" : "Settings"}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setAskDelete(true)} aria-label="Delete this check" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </>
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
