"use client"

/**
 * A table's Google Sheet links: send new records out, bring a sheet in.
 *
 * Two independent halves, because they answer different needs — a
 * registrations sheet the office already watches (export), and a list
 * somebody keeps in a sheet that the CRM should know (import). Neither
 * mirrors edits or deletions; that is said here, where it is decided.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ExternalLink, FilePlus2, Loader2, RefreshCw, Sheet, Trash2, Upload } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { SidePanel, PanelSection } from "./side-panel"
import { GoogleDrivePick } from "@/components/shared/google-drive-pick"
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
  google_email: string | null
  export: LinkView | null
  import: LinkView | null
}

function when(iso: string | null): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
}

function LinkSummary({ link }: { link: LinkView }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3">
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        title={`${link.spreadsheet_name ?? "Spreadsheet"} — ${link.sheet_title}`}
        className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-indigo-700 hover:underline"
      >
        <Sheet className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate">{link.spreadsheet_name ?? "Spreadsheet"}</span>
        <span className="shrink-0 font-normal text-slate-500">· {link.sheet_title}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      <p className="text-[11.5px] text-slate-500">Last update: {when(link.last_synced_at)}</p>
      {link.last_error && <p className="text-[11.5px] leading-relaxed text-rose-600">{link.last_error}</p>}
    </div>
  )
}

export function GoogleSheetPanel({ tableId, tableName, onClose, onImported }: {
  tableId: string
  tableName: string
  onClose: () => void
  /** Rows came in — the grid reloads. */
  onImported: () => void
}) {
  const confirm = useConfirm()
  const [state, setState] = useState<State | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [exportTab, setExportTab] = useState("")
  const [importTab, setImportTab] = useState("")
  const [autoSync, setAutoSync] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, { cache: "no-store" })).json()) as State
      setState(data)
      setFailed(null)
    } catch (err) {
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
      toast.error(errorText(err, "Google Sheets did not answer. Try again."))
      return undefined
    } finally {
      setBusy(null)
      void load()
    }
  }

  const link = (direction: "export" | "import", body: Record<string, unknown>) =>
    run(`${direction}-link`, async () => {
      await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, ...body }),
      })
      toast.success(direction === "export" ? "New records will be added to the sheet." : "Sheet linked. Import its rows below.")
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
      toast.success(
        res.imported === 0
          ? "No new rows — everything in the sheet is already here."
          : `${res.imported} new row${res.imported === 1 ? "" : "s"} imported.`,
      )
      if (res.unmatchedHeaders.length > 0) {
        toast.warning(`These columns match no field and were left out: ${res.unmatchedHeaders.slice(0, 6).join(", ")}`)
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

  const pick = (direction: "export" | "import") => (picked: PickedSheet) => {
    const tab = (direction === "export" ? exportTab : importTab).trim()
    void link(direction, {
      spreadsheet_id: picked.id,
      ...(tab ? { sheet_title: tab } : {}),
      ...(direction === "import" ? { auto_sync: autoSync } : {}),
    })
  }

  return (
    <SidePanel title="Google Sheet" subtitle={tableName} onClose={onClose}>
      <div className="space-y-4">
        {failed && <p className="rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">{failed}</p>}
        {!state && !failed && <div className="h-32 animate-pulse rounded-2xl bg-slate-50" />}

        {state && !state.connected && (
          <div className="rounded-2xl border border-slate-200 p-4 text-[13px] text-slate-600">
            Connect a Google account first, in{" "}
            <a href="/settings?tab=google" className="font-semibold text-indigo-600 hover:underline">Settings → Google</a>.
            Then this table can send its new records to a sheet, or bring a sheet&apos;s rows in.
          </div>
        )}

        {state?.connected && (
          <>
            <PanelSection
              title="Send new records to a sheet"
              hint="Every record saved from now on — by the AI, a Flow, a form or a person — is added as a row. Edits and deletions here are not copied."
            >
              {state.export ? (
                <>
                  <LinkSummary link={state.export} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void exportAll()} disabled={!!busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                      {busy === "export-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Export all records now
                    </button>
                    <button type="button" onClick={() => void unlink("export")} disabled={!!busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                      <Trash2 className="h-3.5 w-3.5" /> Stop
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-3 space-y-2.5">
                  <button type="button" onClick={() => void link("export", { create_new: true })} disabled={!!busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                    {busy === "export-link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}
                    Create a new sheet
                  </button>
                  <p className="text-[11.5px] text-slate-400">or use a sheet you already have:</p>
                  <input value={exportTab} onChange={(e) => setExportTab(e.target.value)} placeholder="Tab name (optional — the first tab if blank)"
                    className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[12.5px] outline-none focus:border-indigo-400" />
                  <GoogleDrivePick onPicked={pick("export")} />
                </div>
              )}
            </PanelSection>

            <PanelSection
              title="Import rows from a sheet"
              hint="The first row must hold this table's field names (as in the Excel template). Each row comes in once — reading the sheet again brings only new rows."
            >
              {state.import ? (
                <>
                  <LinkSummary link={state.import} />
                  <p className="mt-2 text-[11.5px] text-slate-500">{state.import.imported_rows} row{state.import.imported_rows === 1 ? "" : "s"} imported so far.</p>
                  <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                    <span className="text-[12.5px] text-slate-700">Check for new rows every 15 minutes</span>
                    <Switch checked={state.import.auto_sync} disabled={!!busy} onCheckedChange={(v) => void setSync(v)} />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void importNow()} disabled={!!busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                      {busy === "import-now" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Import new rows now
                    </button>
                    <button type="button" onClick={() => void unlink("import")} disabled={!!busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                      <Trash2 className="h-3.5 w-3.5" /> Stop
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-3 space-y-2.5">
                  <input value={importTab} onChange={(e) => setImportTab(e.target.value)} placeholder="Tab name (optional — the first tab if blank)"
                    className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[12.5px] outline-none focus:border-indigo-400" />
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                    <span className="text-[12.5px] text-slate-700">Keep checking for new rows every 15 minutes</span>
                    <Switch checked={autoSync} onCheckedChange={setAutoSync} />
                  </label>
                  <GoogleDrivePick onPicked={pick("import")} />
                  {busy === "import-link" && <p className="flex items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Linking…</p>}
                </div>
              )}
            </PanelSection>

            {state.google_email && (
              <p className="truncate text-[11.5px] text-slate-400" title={state.google_email}>Google account: {state.google_email}</p>
            )}
          </>
        )}
      </div>
    </SidePanel>
  )
}
