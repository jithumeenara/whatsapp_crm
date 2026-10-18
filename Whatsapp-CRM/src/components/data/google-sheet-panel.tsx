"use client"

/**
 * A table's Google Sheet links:
 *
 *   Two-way sync — the table and a sheet tab kept equal both ways: adds,
 *                  edits and deletions, within seconds (sheet-two-way.ts).
 *                  Optional Apps Script makes sheet-side edits instant too.
 *   Import       — a sheet's new rows come in (one way).
 *   Export       — every new record is appended to a sheet (one way).
 *
 * Import opens the wizard (sheet-import-wizard.tsx): every sheet in the
 * account, the tab, and where each column goes — new fields are made
 * from the sheet, so an empty table works.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check, Copy, ExternalLink, FilePlus2, Loader2, RefreshCw, Repeat, Trash2, Undo2, X, Zap } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { SidePanel } from "./side-panel"
import { SheetImportWizard } from "./sheet-import-wizard"
import { GoogleDrivePick } from "@/components/shared/google-drive-pick"
import { GoogleSheetsIcon } from "@/components/shared/google-icons"
import { useConfirm } from "@/hooks/use-confirm"
import { apiFetch, errorText } from "@/lib/api-fetch"
import type { PickedSheet } from "@/lib/google/picker-client"
import { everyWhileVisible } from "@/lib/visible-interval"
import { connectGoogle } from '@/lib/google/connect-popup'

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

interface SyncView {
  id: string
  spreadsheet_name: string | null
  sheet_title: string
  url: string
  linked_rows: number
  held: number
  instant: boolean
  last_synced_at: string | null
  last_error: string | null
  warning: string | null
  stats: {
    fromSheet?: { created: number; updated: number; deleted: number }
    toSheet?: { added: number; updated: number; deleted: number }
  } | null
}

interface State {
  connected: boolean
  can_pick: boolean
  can_browse: boolean
  can_write: boolean
  google_email: string | null
  export: LinkView | null
  import: LinkView | null
  sync: SyncView | null
}

function when(iso: string | null): string {
  if (!iso) return "not yet"
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
}

function lastRun(stats: SyncView["stats"]): string {
  if (!stats) return ""
  const f = stats.fromSheet
  const t = stats.toSheet
  const parts: string[] = []
  const inSum = (f?.created ?? 0) + (f?.updated ?? 0) + (f?.deleted ?? 0)
  const outSum = (t?.added ?? 0) + (t?.updated ?? 0) + (t?.deleted ?? 0)
  if (inSum) parts.push(`${inSum} change${inSum === 1 ? "" : "s"} from the sheet`)
  if (outSum) parts.push(`${outSum} to the sheet`)
  return parts.length ? `Last run: ${parts.join(", ")}.` : "Last run: already in step."
}

function SheetChip({ link }: { link: Pick<LinkView, "url" | "spreadsheet_name" | "sheet_title"> }) {
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
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-emerald-700" />
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
  danger: "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60",
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
  const [wizard, setWizard] = useState<false | "two_way" | "one_way">(false)
  const [instantOpen, setInstantOpen] = useState(false)
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

  async function syncAction(action: "sync_now" | "apply_deletions" | "keep_deleted" | "convert_import", done: string) {
    await run(action, async () => {
      const res = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })).json()) as { ok?: boolean; error?: string; stats?: SyncView["stats"] }
      if (res.ok === false) throw new Error(res.error || "The sync did not finish.")
      toast.success(done)
      onImported()
    })
  }

  async function applyDeletions(held: number) {
    const ok = await confirm({
      title: `Delete ${held} record${held === 1 ? "" : "s"} here too?`,
      description: "Their rows were removed from the Google Sheet. This deletes the matching records in the CRM. It cannot be undone.",
      confirmLabel: "Delete them",
      variant: "destructive",
    })
    if (ok) await syncAction("apply_deletions", "Deleted to match the sheet.")
  }

  const newSyncSheet = () =>
    run("sync-new", async () => {
      const res = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "sync", create_new: true }),
      })).json()) as { synced?: { ok?: boolean; error?: string } }
      if (res.synced && res.synced.ok === false) throw new Error(res.synced.error || "The first sync did not finish.")
      toast.success("A new sheet was made for this table — two-way sync is on.")
      onImported()
    })

  async function stopSync() {
    const ok = await confirm({
      title: "Stop two-way sync?",
      description: "The sheet and the records both stay as they are; they just stop following each other. The CRM ID column stays in the sheet.",
      confirmLabel: "Stop sync",
      variant: "destructive",
    })
    if (!ok) return
    await run("sync-unlink", async () => {
      await apiFetch(`/api/data-tables/${tableId}/google-sheet?direction=sync`, { method: "DELETE" })
      toast.success("Two-way sync stopped.")
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
                icon={<ArrowLeftRight className="h-4.5 w-4.5" />}
                title="Two-way sync"
                hint="The table and a sheet stay the same both ways — add, edit or delete on either side and the other follows within seconds."
              >
                {state.sync ? (
                  <div className="space-y-3">
                    <SheetChip link={state.sync} />
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-slate-500">Rows in sync</p>
                        <p className="text-[15px] font-semibold text-slate-900">{state.sync.linked_rows}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-slate-500">Last synced</p>
                        <p className="truncate text-[12.5px] font-medium text-slate-800">{when(state.sync.last_synced_at)}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] ${state.sync.instant ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}`}>
                      <Zap className={`h-3.5 w-3.5 shrink-0 ${state.sync.instant ? "text-emerald-600" : "text-slate-400"}`} />
                      <span className="min-w-0 flex-1">
                        {state.sync.instant
                          ? "Instant both ways — the sheet tells the CRM the moment it changes."
                          : "CRM changes reach the sheet in seconds; sheet changes are checked every minute."}
                      </span>
                      {!state.sync.instant && (
                        <button type="button" onClick={() => setInstantOpen(true)} className="shrink-0 font-semibold text-[#1A73E8] hover:underline">
                          Make it instant
                        </button>
                      )}
                    </div>
                    {state.sync.stats && !state.sync.last_error && <p className="text-[11.5px] text-slate-500">{lastRun(state.sync.stats)}</p>}

                    {state.sync.held > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-amber-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          {state.sync.held} row{state.sync.held === 1 ? " was" : "s were"} removed from the sheet at once. Nothing was deleted here — choose what to do.
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <button type="button" disabled={!!busy} onClick={() => void applyDeletions(state.sync!.held)} className={btn.danger + " bg-white"}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete them here too
                          </button>
                          <button type="button" disabled={!!busy} onClick={() => void syncAction("keep_deleted", "Put back in the sheet.")} className={btn.soft}>
                            <Undo2 className="h-3.5 w-3.5" /> Put them back in the sheet
                          </button>
                        </div>
                      </div>
                    )}
                    {state.sync.warning && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">{state.sync.warning}</p>}
                    {state.sync.last_error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-700">{state.sync.last_error}</p>}

                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void syncAction("sync_now", "In sync.")} disabled={!!busy} className={btn.primary}>
                        {busy === "sync_now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
                      </button>
                      {state.sync.instant && (
                        <button type="button" onClick={() => setInstantOpen(true)} disabled={!!busy} className={btn.soft}>
                          <Zap className="h-3.5 w-3.5" /> Instant setup
                        </button>
                      )}
                      <button type="button" onClick={() => void stopSync()} disabled={!!busy} className={btn.danger}>
                        <Trash2 className="h-3.5 w-3.5" /> Stop
                      </button>
                    </div>
                  </div>
                ) : !state.can_write ? (
                  <div className="space-y-2">
                    <p className="text-[12px] leading-relaxed text-slate-500">Two-way sync needs permission to change the sheets you link here.</p>
                    <button type="button"
                      onClick={() => connectGoogle(`/api/google/connect?services=sheets_sync&return=${encodeURIComponent(`/data/${tableId}`)}`, (r) => {
                        if (r.outcome === 'error') toast.error(r.reason || 'Google was not connected.')
                        if (r.outcome !== 'closed') void load()
                      })}
                      className={`${btn.primary} w-full !bg-[#1A73E8] hover:!bg-[#1765CC]`}>
                      Allow two-way sync
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {state.import && (
                      <button type="button" onClick={() => void syncAction("convert_import", "Two-way sync is on for this sheet.")} disabled={!!busy} className={`${btn.primary} w-full`}>
                        {busy === "convert_import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />} Turn on two-way sync for “{state.import.sheet_title}”
                      </button>
                    )}
                    <button type="button" onClick={() => setWizard("two_way")} disabled={!!busy} className={`${state.import ? btn.soft : btn.primary} w-full`}>
                      <GoogleSheetsIcon className="h-4 w-4 rounded-sm bg-white" /> Choose a Google Sheet
                    </button>
                    <button type="button" onClick={() => void newSyncSheet()} disabled={!!busy} className={`${btn.soft} w-full`}>
                      {busy === "sync-new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />} Create a new sheet for this table
                    </button>
                  </div>
                )}
              </Card>

              {!state.sync && (
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
                      <button type="button" onClick={() => setWizard("one_way")} disabled={!!busy} className={btn.soft}>Change sheet</button>
                      <button type="button" onClick={() => void unlink("import")} disabled={!!busy} className={btn.danger}>
                        <Trash2 className="h-3.5 w-3.5" /> Stop
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setWizard("one_way")} className={`${btn.primary} w-full`}>
                    <GoogleSheetsIcon className="h-4 w-4 rounded-sm bg-white" /> Choose a Google Sheet
                  </button>
                )}
              </Card>
              )}

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
          defaultSync={wizard}
          onClose={() => setWizard(false)}
          onDone={() => {
            onImported()
            void load()
          }}
        />
      )}

      {instantOpen && (
        <InstantSetup
          tableId={tableId}
          onClose={() => {
            setInstantOpen(false)
            void load()
          }}
        />
      )}
    </>
  )
}

/**
 * "Make it instant": the Apps Script, three steps, and a live check that
 * it is working. The script only tells the CRM "the sheet changed".
 */
function InstantSetup({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const [script, setScript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const d = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet/instant`, { cache: "no-store" })).json()) as { script: string }
        if (alive) setScript(d.script)
      } catch (err) {
        console.error("[instant sheet] load failed:", err)
        if (alive) setError(errorText(err, "Could not prepare the script."))
      }
    })()
    return () => { alive = false }
  }, [tableId])

  // Has the sheet called in yet? Checked every 5 s while this is open.
  useEffect(() => {
    if (working) return
    const check = async () => {
      try {
        const d = (await (await apiFetch(`/api/data-tables/${tableId}/google-sheet`, { cache: "no-store" })).json()) as State
        if (d.sync?.instant) setWorking(true)
      } catch {
        // quiet: this is only a status check
      }
    }
    return everyWhileVisible(() => void check(), 5000)
  }, [tableId, working])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function copy() {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      toast.success("Script copied")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy — select the script and copy it by hand.")
    }
  }

  const steps = [
    "Open the sheet. Menu: Extensions → Apps Script.",
    "Delete what is there, paste the script, and press Save (💾).",
    "Choose “install” at the top and press ▶ Run. Allow access when Google asks (Advanced → Go to … if it warns).",
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Make sheet sync instant">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Zap className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-slate-900">Make sheet changes instant</h2>
            <p className="text-[12px] text-slate-500">One-time setup, about a minute. Without it, sheet changes arrive within a minute.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <ol className="space-y-2">
            {steps.map((t, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-slate-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1A73E8] text-[11px] font-semibold text-white">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          {error && <p className="rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">{error}</p>}
          {!script && !error && <div className="h-40 animate-pulse rounded-2xl bg-slate-50" />}
          {script && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-[11.5px] font-medium text-slate-500">Apps Script</span>
                <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto bg-slate-900 p-3 text-[11.5px] leading-relaxed text-slate-100"><code>{script}</code></pre>
            </div>
          )}
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            The script only tells the CRM “this sheet changed” — it sends no sheet data. Keep it private: it holds this link’s key. Anyone with edit access to the sheet can see it.
          </p>
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] ${working ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}`} role="status" aria-live="polite">
            {working ? <Check className="h-4 w-4 text-emerald-600" /> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {working ? "Working — the sheet has called in. Changes there now sync instantly." : "Waiting for the sheet to call in… (after you press ▶ Run)"}
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-6 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-100">
            {working ? "Done" : "Close"}
          </button>
        </div>
      </div>
    </div>
  )
}
