"use client"

/**
 * A table's Google Sheet links: bring a sheet in, send new records out.
 *
 * Import opens the wizard (sheet-import-wizard.tsx): every sheet in the
 * account, the tab, and where each column goes — new fields are made
 * from the sheet, so an empty table works. Export appends each new
 * record to a sheet. Neither mirrors edits or deletions; that is said
 * here, where it is decided.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, FilePlus2, Loader2, RefreshCw, Repeat, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { SidePanel } from "./side-panel"
import { SheetImportWizard } from "./sheet-import-wizard"
import { GoogleDrivePick } from "@/components/shared/google-drive-pick"
import { GoogleSheetsIcon } from "@/components/shared/google-icons"
import { useConfirm } from "@/hooks/use-confirm"
import { apiFetch, errorText } from "@/lib/api-fetch"
import type { PickedSheet } from "@/lib/google/picker-client"

interface LinkView {
  id: string
  spreadsheet_id: string
  spreadsheet_name: string | null
  sheet_title: string
  url: string
  auto_sync: boolean
  imported_rows: number
  last_synced_at: string | null
  last_error: string | null
}

interface State {
  connected: boolean
  can_pick: boolean
  can_browse: boolean
  google_email: string | null
  export: LinkView | null
  import: LinkView | null
}

function when(iso: string | null): string {
  if (!iso) return "not yet"
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
}

function SheetChip({ link }: { link: LinkView }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      title={`${link.spreadsheet_name ?? "Spreadsheet"} — ${link.sheet_title}`}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300"
    >
      <GoogleSheetsIcon className="h-8 w-8 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-800">{link.spreadsheet_name ?? "Spreadsheet"}</span>
        <span className="block truncate text-[11.5px] text-slate-500">Tab: {link.sheet_title}</span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-emerald-600" />
    </a>
  )
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-600">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{hint}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const btn = {
  primary: "inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60",
  soft: "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60",
  danger: "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60",
}

export function GoogleSheetPanel({ tableId, tableName, onClose, onImported }: {
  tableId: string
  tableName: string
  onClose: () => void
  /** Rows (and maybe fields) came in — the grid reloads. */
  onImported: () => void
}) {
  const confirm = useConfirm()
  const [state, setState] = useState<State | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [exportTab, setExportTab] = useState("")

  const load = useCallback(async () => {
    try {
      const data = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, { cache: "no-store" })).json()) as State
      setState(data)
      setFailed(null)
    } catch (err) {
      console.error("[google sheet panel] load failed:", err)
      setFailed(errorText(err, "Could not load the Google Sheet settings."))
    }
  }, [tableId])

  useEffect(() => { void load() }, [load])

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined
    setBusy(key)
    try {
      return await fn()
    } catch (err) {
      console.error(`[google sheet panel] ${key} failed:`, err)
      toast.error(errorText(err, "Google Sheets did not answer. Try again."))
      return undefined
    } finally {
      setBusy(null)
      void load()
    }
  }

  const linkExport = (body: Record<string, unknown>) =>
    run("export-link", async () => {
      await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "export", ...body }),
      })
      toast.success("New records will be added to the sheet.")
    })

  async function exportAll() {
    const ok = await confirm({
      title: "Write every record to the sheet?",
      description: "The tab is cleared and rewritten with all records (up to 5,000), newest last. Anything typed into that tab by hand is replaced.",
      confirmLabel: "Export all",
    })
    if (!ok) return
    await run("export-all", async () => {
      const res = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export_all" }),
      })).json()) as { rows: number; capped: boolean }
      toast.success(`${res.rows} record${res.rows === 1 ? "" : "s"} written to the sheet${res.capped ? " (the first 5,000)" : ""}.`)
    })
  }

  async function importNow() {
    await run("import-now", async () => {
      const res = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_now" }),
      })).json()) as { imported: number; skipped: number; unmatchedHeaders: string[] }
      toast.success(res.imported === 0 ? "No new rows — everything in the sheet is already here." : `${res.imported} new row${res.imported === 1 ? "" : "s"} imported.`)
      if (res.unmatchedHeaders.length > 0) {
        toast.warning(`New columns in the sheet were left out: ${res.unmatchedHeaders.slice(0, 6).join(", ")}. Use “Change sheet” to map them.`)
      }
      if (res.imported > 0) onImported()
    })
  }

  async function unlink(direction: "export" | "import") {
    const ok = await confirm({
      title: direction === "export" ? "Stop sending records to this sheet?" : "Stop importing from this sheet?",
      description: "The sheet itself is not changed or deleted. Records already in the table stay.",
      confirmLabel: "Stop",
      variant: "destructive",
    })
    if (!ok) return
    await run(`${direction}-unlink`, async () => {
      await apiFetch(`/api/data-tables/${tableId}/google-sheet?direction=${direction}`, { method: "DELETE" })
      toast.success("Stopped.")
    })
  }

  async function setSync(value: boolean) {
    await run("sync", async () => {
      await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_sync: value }),
      })
    })
  }

  const pickExport = (picked: PickedSheet) => {
    const tab = exportTab.trim()
    void linkExport({ spreadsheet_id: picked.id, ...(tab ? { sheet_title: tab } : {}) })
  }

  return (
    <>
      <SidePanel title="Google Sheets" subtitle={tableName} icon={<GoogleSheetsIcon className="h-5 w-5" />} onClose={onClose}>
        <div className="space-y-4">
          {failed && <p className="rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">{failed}</p>}
          {!state && !failed && <div className="h-40 animate-pulse rounded-2xl bg-slate-50" />}

          {state && !state.connected && (
            <div className="rounded-2xl border border-slate-200 p-5 text-center">
              <GoogleSheetsIcon className="mx-auto h-10 w-10" />
              <p className="mt-3 text-[13.5px] font-semibold text-slate-800">Connect Google first</p>
              <p className="mt-1 text-[12.5px] text-slate-500">Then this table can import a sheet, or send its new records to one.</p>
              <a href="/settings?tab=google" className="mt-4 inline-flex h-9 items-center rounded-xl bg-[#1A73E8] px-4 text-[13px] font-semibold text-white hover:bg-[#1765CC]">
                Open Settings → Google
              </a>
            </div>
          )}

          {state?.connected && (
            <>
              <Card
                icon={<ArrowDownToLine className="h-4.5 w-4.5" />}
                title="Import a sheet into this table"
                hint="Choose any sheet and tab, and where each column goes. Missing fields are created for you."
              >
                {state.import ? (
                  <div className="space-y-3">
                    <SheetChip link={state.import} />
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-slate-500">Rows imported</p>
                        <p className="text-[15px] font-semibold text-slate-900">{state.import.imported_rows}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-slate-500">Last checked</p>
                        <p className="truncate text-[12.5px] font-medium text-slate-800">{when(state.import.last_synced_at)}</p>
                      </div>
                    </div>
                    {state.import.last_error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-700">{state.import.last_error}</p>}
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-[12.5px] text-slate-700"><Repeat className="h-3.5 w-3.5 text-slate-400" /> New rows every 15 minutes</span>
                      <Switch checked={state.import.auto_sync} disabled={!!busy} onCheckedChange={(v) => void setSync(v)} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void importNow()} disabled={!!busy} className={btn.primary}>
                        {busy === "import-now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Import new rows
                      </button>
                      <button type="button" onClick={() => setWizard(true)} disabled={!!busy} className={btn.soft}>Change sheet</button>
                      <button type="button" onClick={() => void unlink("import")} disabled={!!busy} className={btn.danger}>
                        <Trash2 className="h-3.5 w-3.5" /> Stop
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setWizard(true)} className={`${btn.primary} w-full`}>
                    <GoogleSheetsIcon className="h-4 w-4 rounded-sm bg-white" /> Choose a Google Sheet
                  </button>
                )}
              </Card>

              <Card
                icon={<ArrowUpFromLine className="h-4.5 w-4.5" />}
                title="Send new records to a sheet"
                hint="Every record saved from now on — by the AI, a Flow, a form or a person — is added as a row. Edits here are not copied."
              >
                {state.export ? (
                  <div className="space-y-3">
                    <SheetChip link={state.export} />
                    <p className="text-[11.5px] text-slate-500">Last update: {when(state.export.last_synced_at)}</p>
                    {state.export.last_error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{state.export.last_error}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void exportAll()} disabled={!!busy} className={btn.soft}>
                        {busy === "export-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Export all records now
                      </button>
                      <button type="button" onClick={() => void unlink("export")} disabled={!!busy} className={btn.danger}>
                        <Trash2 className="h-3.5 w-3.5" /> Stop
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button type="button" onClick={() => void linkExport({ create_new: true })} disabled={!!busy} className={`${btn.soft} w-full`}>
                      {busy === "export-link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />} Create a new sheet for this table
                    </button>
                    {state.can_pick && (
                      <details className="rounded-xl border border-slate-200 px-3 py-2">
                        <summary className="cursor-pointer select-none text-[12px] font-medium text-slate-600">Use a sheet I already have</summary>
                        <div className="mt-2 space-y-2">
                          <input value={exportTab} onChange={(e) => setExportTab(e.target.value)} placeholder="Tab name (blank = first tab)"
                            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-[12.5px] outline-none focus:border-emerald-500" />
                          <GoogleDrivePick onPicked={pickExport} label="Choose the sheet in Google" />
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </Card>

              {state.google_email && (
                <p className="truncate text-center text-[11.5px] text-slate-400" title={state.google_email}>Connected as {state.google_email}</p>
              )}
            </>
          )}
        </div>
      </SidePanel>

      {wizard && state && (
        <SheetImportWizard
          tableId={tableId}
          tableName={tableName}
          canPick={state.can_pick}
          onClose={() => setWizard(false)}
          onDone={() => {
            onImported()
            void load()
          }}
        />
      )}
    </>
  )
}
