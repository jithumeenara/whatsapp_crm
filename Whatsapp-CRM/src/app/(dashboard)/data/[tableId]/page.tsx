"use client"

/**
 * One Data Store table.
 *
 * Two quiet rows above the grid, and nothing bulky: the title row holds
 * the table's name, its AI state and the few actions people use daily
 * (share the form, alerts, Add record) with the rest in one "more" menu;
 * the tool row holds search and the ways to narrow and shape the view —
 * filter, source, which columns, how dense. Selecting rows swaps the
 * tool row for what can be done to them.
 *
 * The grid pins the tick box on the left and the row actions on the
 * right on solid backgrounds, so a long value can never show through
 * them; every value is cut to one line with the full text on hover.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BellRing, Check, ChevronLeft, ChevronRight, Columns3, Database,
  Download, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Rows3, Rows4, Search, Settings2, Share2,
  SlidersHorizontal, Trash2, Upload, X,
  Type, AlignLeft, Hash, Mail, KeyRound, Phone, Link2, Calendar, Clock, CalendarClock, ToggleLeft,
  ChevronDown, ListChecks, CircleDot, Globe, MapPin, Home, Link as LinkIcon, Paperclip, ImageIcon,
  PenLine, EyeOff, Heading, Code2,
  HeartPulse, Sheet, Split, LayoutGrid, Table2, FileDown, Users,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { chipFieldKeys, chipTone, choiceLabel, initials, pageList, pickSubtitleField, pickTitleField, quickFilterFields, statCards, toCsv } from "@/lib/data-store/table-view"
import { toast } from "sonner"
import { RecordForm } from "@/components/data/record-form"
import { FieldEditor } from "@/components/data/field-editor"
import { RecordDetailModal } from "@/components/data/record-detail-modal"
import { AiRegistrationToggle } from "@/components/data/ai-registration-toggle"
import { RecordFilters } from "@/components/data/record-filters"
import { applyFilters, activeFilterCount, filterableFields, optionsFor, type FilterMap } from "@/lib/data-store/filters"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TableAiChip } from "@/components/data/table-ai-chip"
import { RecordAlertsPanel } from "@/components/data/record-alerts-panel"
import { PublicFormPanel } from "@/components/data/public-form-panel"
import { SidePanel } from "@/components/data/side-panel"
import { DataHealthPanel } from "@/components/data/data-health-panel"
import { GoogleSheetPanel } from "@/components/data/google-sheet-panel"
import { SheetRoutingPanel } from "@/components/data/sheet-routing-panel"
import { LinkedFieldsCard } from "@/components/data/linked-fields-card"
import { parseFormConfig } from "@/lib/data-store/public-form"
import { RECORD_SOURCE_LABELS, isRecordSource, sourceLabel, type RecordSource } from "@/lib/data-store/sources"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { cn } from "@/lib/utils"
import type { DataTable, DataField, DataRecord, FieldType } from "@/lib/data-store/types"

const FIELD_TYPE_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  text: Type, textarea: AlignLeft, number: Hash, email: Mail, password: KeyRound,
  phone: Phone, url: Link2, date: Calendar, time: Clock, datetime: CalendarClock,
  boolean: ToggleLeft, select: ChevronDown, multiselect: ListChecks, radio: CircleDot,
  country: Globe, state: MapPin, district: MapPin, address: Home, relation: LinkIcon,
  file: Paperclip, image: ImageIcon, signature: PenLine, hidden: EyeOff,
  section_header: Heading, html_block: Code2,
}

/** Columns that hold no value and never belong in a grid. */
const NOT_A_COLUMN = new Set<string>(["section_header", "html_block"])

/** One colour per channel, so a glance down the Source column says
 *  where the week's sign-ups came from. */
const SOURCE_STYLE: Record<RecordSource, string> = {
  manual: "bg-slate-100 text-slate-600",
  api: "bg-slate-100 text-slate-600",
  import: "bg-slate-100 text-slate-500",
  whatsapp_ai: "bg-emerald-50 text-emerald-700",
  chatbot: "bg-teal-50 text-teal-700",
  whatsapp_flow: "bg-green-50 text-green-700",
  web_form: "bg-sky-50 text-sky-700",
  payment: "bg-amber-50 text-amber-700",
  integration: "bg-violet-50 text-violet-700",
  google_sheet: "bg-lime-50 text-lime-700",
  google_form: "bg-purple-50 text-purple-700",
}

/** The system columns, keyed so they can be hidden and sorted like fields. */
const SYS = { customer: "__customer", source: "__source", added: "__added" } as const

/** Everything a table holds, a page of 500 at a time. The API used to
 *  cap one request at 100, so a table past that showed only its newest
 *  hundred rows with nothing saying the rest existed. */
const LOAD_PAGE = 500
const LOAD_MAX = 10_000
const PAGE_SIZES = [25, 50, 100] as const

type Density = "comfortable" | "compact"
type Sort = { key: string; dir: "asc" | "desc" } | null

function formatValue(field: DataField, value: unknown): string {
  if (value === null || value === undefined || value === "") return ""
  if (field.field_type === "boolean") return value ? "Yes" : "No"
  // A choice shows its label ("September"), not the code it is stored as.
  const label = (v: unknown) => (typeof v === "object" && v ? String((v as { label?: unknown }).label ?? "") : choiceLabel(field, String(v)))
  if (Array.isArray(value)) return value.map(label).join(", ")
  if (["select", "radio", "multiselect"].includes(field.field_type) && typeof value !== "object") return label(value)
  if (typeof value === "object") {
    const v = value as { label?: unknown; name?: unknown }
    return String(v.label ?? v.name ?? "")
  }
  const str = String(value)
  if (field.field_type === "date") {
    const d = /^\d{10}$/.test(str) ? new Date(parseInt(str) * 1000) : new Date(str)
    return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
  }
  return str
}

function stamp(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

// ── View preferences, per table, in this browser only ───────────────────
type ViewMode = "table" | "cards"
interface ViewPrefs { hidden: string[]; density: Density; pageSize: number; view: ViewMode }

function readPrefs(tableId: string): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(`data-view:${tableId}`)
    const p = raw ? (JSON.parse(raw) as Partial<ViewPrefs>) : {}
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((k): k is string => typeof k === "string") : [],
      density: p.density === "compact" ? "compact" : "comfortable",
      pageSize: PAGE_SIZES.includes(p.pageSize as (typeof PAGE_SIZES)[number]) ? (p.pageSize as number) : 25,
      // A phone starts on cards: a wide grid is a sideways scroll there.
      view: p.view === "cards" || p.view === "table" ? p.view : window.innerWidth < 640 ? "cards" : "table",
    }
  } catch {
    return { hidden: [], density: "comfortable", pageSize: 25, view: "table" }
  }
}

function writePrefs(tableId: string, prefs: ViewPrefs) {
  try { window.localStorage.setItem(`data-view:${tableId}`, JSON.stringify(prefs)) } catch { /* private window */ }
}

// ── Small building blocks ───────────────────────────────────────────────
/** A button-triggered panel that closes on a click elsewhere or Escape. */
function Menu({
  label, icon, badge, active, align = "left", children, width = "w-60", iconOnly,
}: {
  label: string
  icon: React.ReactNode
  badge?: number
  active?: boolean
  align?: "left" | "right"
  width?: string
  iconOnly?: boolean
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors",
          iconOnly ? "w-8 justify-center" : "px-2.5",
          active || open ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {icon}
        {!iconOnly && <span className="hidden sm:inline">{label}</span>}
        {!!badge && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-slate-900/20 sm:bg-transparent" onClick={() => setOpen(false)} />
          {/* On a phone a sheet from the bottom — a dropdown beside a button
              near the screen's edge opened off-screen. */}
          <div className={cn(
            "fixed inset-x-3 bottom-3 z-40 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl",
            "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-10 sm:max-h-none sm:rounded-xl sm:p-1 sm:shadow-xl",
            width.split(" ").map((w) => `sm:${w}`).join(" "),
            align === "right" ? "sm:right-0" : "sm:left-0",
          )}>
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
        danger ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <span className="text-slate-400">{icon}</span>
      {children}
    </button>
  )
}

export default function DataTablePage() {
  const { tableId } = useParams<{ tableId: string }>()
  const router = useRouter()
  const { accountRole } = useAuth()
  const isAdmin = !!accountRole && hasMinRole(accountRole, "admin")

  const [table, setTable] = useState<DataTable | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [records, setRecords] = useState<DataRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<FilterMap>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sourceFilter, setSourceFilter] = useState("")
  const [sort, setSort] = useState<Sort>(null)
  const [prefs, setPrefs] = useState<ViewPrefs>({ hidden: [], density: "comfortable", pageSize: 25, view: "table" })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DataRecord | null>(null)
  const [viewingRecord, setViewingRecord] = useState<DataRecord | null>(null)
  const [confirmRecordId, setConfirmRecordId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [fieldPanelOpen, setFieldPanelOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [routingOpen, setRoutingOpen] = useState(false)
  // Back from Google's permission screen (Import → "Allow access"):
  // reopen the sheet panel and say how it went, then tidy the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const outcome = q.get("google")
    if (!outcome) return
    if (outcome === "connected") toast.success("Google Sheets access allowed — choose a sheet to import.")
    else toast.error(q.get("reason") || "Google access was not completed.")
    setSheetOpen(true)
    window.history.replaceState(null, "", window.location.pathname)
  }, [])
  const [healthOpen, setHealthOpen] = useState(false)
  const [formPanelOpen, setFormPanelOpen] = useState(false)
  const [allTables, setAllTables] = useState<DataTable[]>([])
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  // The table's linked fields (month → programme → dates), which Add
  // Record applies exactly as the public form does.
  const linkConfig = useMemo(
    () => parseFormConfig(table?.form_config, fields.map((f) => f.field_key)),
    [table, fields],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/data-tables/${tableId}`),
        fetch(`/api/data-tables/${tableId}/records?pageSize=${LOAD_PAGE}&page=1`),
      ])
      if (!tRes.ok) { router.push("/data"); return }
      const tData = await tRes.json()
      const rData = await rRes.json()
      const all: DataRecord[] = rData.records ?? []
      const count: number = rData.total ?? all.length
      for (let p = 2; all.length < Math.min(count, LOAD_MAX) && p <= Math.ceil(LOAD_MAX / LOAD_PAGE); p++) {
        const more = await fetch(`/api/data-tables/${tableId}/records?pageSize=${LOAD_PAGE}&page=${p}`)
        if (!more.ok) break
        const next = ((await more.json()).records ?? []) as DataRecord[]
        if (next.length === 0) break
        all.push(...next)
      }
      setTable(tData.table)
      setFields(tData.table?.fields ?? [])
      setRecords(all)
      setTotal(count)
      setPrefs(readPrefs(tableId))
    } catch { toast.error("Could not load this table") }
    finally { setLoading(false) }
  }, [tableId, router])

  useEffect(() => { load() }, [load])

  // The search and the open record live in the address, so a link or a
  // reload brings back the same view (?q=…&r=<record id>).
  const urlRead = useRef(false)
  useEffect(() => {
    if (urlRead.current || loading) return
    urlRead.current = true
    const q = new URLSearchParams(window.location.search)
    const t = setTimeout(() => {
      if (q.get("q")) setSearch(q.get("q") ?? "")
      const rid = q.get("r")
      if (rid) {
        const rec = records.find((x) => x.id === rid)
        if (rec) setViewingRecord(rec)
      }
    }, 0)
    return () => clearTimeout(t)
  }, [loading, records])
  useEffect(() => {
    if (!urlRead.current) return
    const q = new URLSearchParams(window.location.search)
    if (search.trim()) q.set("q", search.trim())
    else q.delete("q")
    if (viewingRecord) q.set("r", viewingRecord.id)
    else q.delete("r")
    const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next)
  }, [search, viewingRecord])

  function updatePrefs(patch: Partial<ViewPrefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      writePrefs(tableId, next)
      return next
    })
  }

  const openFieldPanel = useCallback(async () => {
    setFieldPanelOpen(true)
    if (allTables.length === 0) {
      try {
        const res = await fetch("/api/data-tables")
        const data = await res.json()
        setAllTables(data.tables ?? [])
      } catch { /* the relation picker just shows fewer tables */ }
    }
  }, [allTables.length])

  async function downloadTemplate() {
    try {
      const res = await fetch(`/api/data-tables/${tableId}/import`)
      if (!res.ok) { toast.error("Could not make the template"); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${table?.name ?? "template"}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error("Could not make the template") }
  }

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/data-tables/${tableId}/import`, { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Import failed"); return }
      toast.success(`Imported ${data.count} record${data.count !== 1 ? "s" : ""}`)
      load()
    } catch { toast.error("Import failed") }
    finally { setImporting(false) }
  }

  async function confirmDelete() {
    if (!confirmRecordId) return
    const id = confirmRecordId
    setConfirmRecordId(null)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/records/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setRecords((p) => p.filter((r) => r.id !== id))
      setTotal((t) => Math.max(0, t - 1))
      toast.success("Record deleted")
    } catch { toast.error("Could not delete that record") }
  }

  async function confirmBulkDeleteRecords() {
    const ids = Array.from(selectedIds)
    setConfirmBulkDelete(false)
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/data-tables/${tableId}/records/${id}`, { method: "DELETE" }).then((r) => { if (!r.ok) throw new Error() })),
      )
      const gone = new Set(ids.filter((_, i) => results[i].status === "fulfilled"))
      const failed = ids.length - gone.size
      setRecords((p) => p.filter((r) => !gone.has(r.id)))
      setTotal((t) => Math.max(0, t - gone.size))
      setSelectedIds(new Set())
      if (failed > 0) toast.error(`${failed} record${failed !== 1 ? "s" : ""} could not be deleted`)
      else toast.success(`${ids.length} record${ids.length !== 1 ? "s" : ""} deleted`)
    } finally { setBulkDeleting(false) }
  }

  // ── What is shown ─────────────────────────────────────────────────────
  // Search reads every column; the filter bar narrows one column at a
  // time; the source picker narrows by channel. They compose.
  const needle = search.trim().toLowerCase()
  const searched = records.filter((r) => {
    if (sourceFilter && (r.source ?? "") !== sourceFilter) return false
    if (!needle) return true
    return (
      Object.values(r.data as Record<string, unknown>).some((v) => String(v ?? "").toLowerCase().includes(needle)) ||
      (r.contact?.name ?? "").toLowerCase().includes(needle) ||
      (r.contact?.phone ?? "").includes(needle) ||
      sourceLabel(r.source).toLowerCase().includes(needle)
    )
  })
  const filtered = applyFilters(searched, fields, filters)
  const activeFilters = activeFilterCount(filters)
  const canFilter = filterableFields(fields, records).length > 0
  const presentSources = Array.from(new Set(records.map((r) => r.source).filter(isRecordSource)))
  const hasCustomers = records.some((r) => r.contact)

  const columnFields = fields.filter((f) => !NOT_A_COLUMN.has(f.field_type))
  const hidden = new Set(prefs.hidden)
  const shownFields = columnFields.filter((f) => !hidden.has(f.field_key))
  const showCustomer = hasCustomers && !hidden.has(SYS.customer)
  const showSource = !hidden.has(SYS.source)
  const showAdded = !hidden.has(SYS.added)

  function sortValue(r: DataRecord, key: string): string | number {
    if (key === SYS.added) return Date.parse(r.created_at) || 0
    if (key === SYS.source) return sourceLabel(r.source)
    if (key === SYS.customer) return r.contact?.name || r.contact?.phone || ""
    const field = fields.find((f) => f.field_key === key)
    const raw = (r.data as Record<string, unknown>)[key]
    if (field?.field_type === "number" && raw !== "" && raw !== null && raw !== undefined && Number.isFinite(Number(raw))) return Number(raw)
    if ((field?.field_type === "date" || field?.field_type === "datetime") && raw) return Date.parse(String(raw)) || String(raw)
    return field ? formatValue(field, raw) : ""
  }

  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const x = sortValue(a, sort.key)
        const y = sortValue(b, sort.key)
        // Empty values last, whichever way.
        if (x === "" && y !== "") return 1
        if (y === "" && x !== "") return -1
        const c = typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" })
        return sort.dir === "asc" ? c : -c
      })
    : filtered

  const pageSize = prefs.pageSize
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRecords = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const firstShown = sorted.length ? (currentPage - 1) * pageSize + 1 : 0
  const lastShown = Math.min(sorted.length, currentPage * pageSize)

  // A narrower result starts again at page 1.
  useEffect(() => { setPage(1) }, [search, filters, sourceFilter, sort, prefs.pageSize])

  const allPageSelected = pageRecords.length > 0 && pageRecords.every((r) => selectedIds.has(r.id))

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const r of pageRecords) {
        if (allPageSelected) next.delete(r.id)
        else next.add(r.id)
      }
      return next
    })
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function cycleSort(key: string) {
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null))
  }

  function toggleColumn(key: string) {
    const next = new Set(prefs.hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    updatePrefs({ hidden: Array.from(next) })
  }

  const cellY = prefs.density === "compact" ? "py-1.5" : "py-2.5"

  // Presentation, chosen from this table's own fields (table-view.ts).
  const titleField = useMemo(() => pickTitleField(columnFields, records), [columnFields, records])
  const chipKeys = useMemo(() => chipFieldKeys(fields, records), [fields, records])
  const subField = useMemo(() => pickSubtitleField(columnFields, titleField, chipKeys), [columnFields, titleField, chipKeys])
  const stats = useMemo(() => statCards(columnFields, records), [columnFields, records])
  const quick = useMemo(() => quickFilterFields(columnFields, records), [columnFields, records])

  function setQuick(key: string, value: string | null) {
    setFilters((prev) => {
      const next = { ...prev }
      if (!value) delete next[key]
      else next[key] = { kind: "choice", value }
      return next
    })
  }

  /** The rows on screen (or the selected ones) as a CSV file. */
  function exportCsv(onlySelected: boolean) {
    const rows = onlySelected ? sorted.filter((r) => selectedIds.has(r.id)) : sorted
    const cols = shownFields
    const csv = toCsv(
      [...cols.map((f) => f.label), "Source", "Added"],
      rows.map((r) => [
        ...cols.map((f) => formatValue(f, (r.data as Record<string, unknown>)[f.field_key])),
        sourceLabel(r.source),
        stamp(r.created_at),
      ]),
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${(table?.name ?? "records").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "records"}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${rows.length} row${rows.length === 1 ? "" : "s"} exported`)
  }

  function chip(f: DataField, raw: unknown) {
    const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && v !== "")
    if (list.length === 0) return <span className="text-slate-300">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {list.slice(0, 3).map((v, i) => {
          const label = formatValue(f, Array.isArray(raw) ? [v] : v) || String(v)
          return (
            <span key={i} title={label} className={cn("inline-block max-w-[180px] truncate rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1", chipTone(label))}>
              {label}
            </span>
          )
        })}
        {list.length > 3 && <span className="text-[11px] text-slate-400">+{list.length - 3}</span>}
      </span>
    )
  }

  function nameCell(rec: DataRecord) {
    const data = rec.data as Record<string, unknown>
    const name = titleField ? formatValue(titleField, data[titleField.field_key]) : ""
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5 text-[13px]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11.5px] font-semibold text-slate-700 ring-1 ring-slate-200" aria-hidden>{initials(name || "?")}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-800" title={name}>{name || <span className="text-slate-300">—</span>}</span>
        </span>
      </span>
    )
  }

  function headerCell(sortKey: string, label: string, Icon?: React.ComponentType<{ className?: string }>) {
    const active = sort?.key === sortKey
    const SortIcon = !active ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown
    return (
      <th
        key={sortKey}
        scope="col"
        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
        className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-0 text-left"
      >
        <button
          type="button"
          onClick={() => cycleSort(sortKey)}
          className="group/h flex h-10 w-full items-center gap-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          <span className="truncate">{label}</span>
          <SortIcon className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-transparent group-hover/h:text-slate-300")} />
        </button>
      </th>
    )
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* ── Title row ───────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => router.push("/data")}
            aria-label="Back to Data Store"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:grid">
            <Database className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16px] font-semibold leading-tight text-slate-900">{table?.name ?? " "}</h1>
            <p className="mt-0.5 truncate text-[12px] text-slate-500">
              <button onClick={() => router.push("/data")} className="hover:text-slate-800 hover:underline">Data Store</button>
              {!loading && (
                <>
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="tabular-nums">{total || records.length}</span> record{(total || records.length) === 1 ? "" : "s"}
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="tabular-nums">{columnFields.length}</span> field{columnFields.length === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="hidden md:block"><TableAiChip tableId={tableId} /></div>
            {isAdmin && (
              <>
                <button
                  onClick={() => setFormPanelOpen(true)}
                  title="Collect data with a public form"
                  className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:flex"
                >
                  <Share2 className="h-3.5 w-3.5" /> Share form
                </button>
                <button
                  onClick={() => setAlertsOpen(true)}
                  title="Alerts for new records"
                  aria-label="Alerts for new records"
                  className="hidden h-8 w-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:grid"
                >
                  <BellRing className="h-4 w-4" />
                </button>
              </>
            )}
            <Menu label="More" icon={<MoreHorizontal className="h-4 w-4" />} iconOnly align="right" width="w-64">
              {(close) => (
                <>
                  <MenuItem icon={<Settings2 className="h-4 w-4" />} onClick={() => { close(); void openFieldPanel() }}>Fields &amp; AI registration</MenuItem>
                  <MenuItem icon={<HeartPulse className="h-4 w-4" />} onClick={() => { close(); setHealthOpen(true) }}>Data health</MenuItem>
                  {isAdmin && (
                    <MenuItem icon={<Sheet className="h-4 w-4" />} onClick={() => { close(); setSheetOpen(true) }}>Google Sheet</MenuItem>
                  )}
                  {isAdmin && (
                    <MenuItem icon={<Split className="h-4 w-4" />} onClick={() => { close(); setRoutingOpen(true) }}>Sheet routing</MenuItem>
                  )}
                  {isAdmin && (
                    <div className="sm:hidden">
                      <MenuItem icon={<Share2 className="h-4 w-4" />} onClick={() => { close(); setFormPanelOpen(true) }}>Share form</MenuItem>
                      <MenuItem icon={<BellRing className="h-4 w-4" />} onClick={() => { close(); setAlertsOpen(true) }}>Alerts</MenuItem>
                    </div>
                  )}
                  <div className="my-1 h-px bg-slate-100" />
                  <MenuItem icon={importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} onClick={() => { close(); importRef.current?.click() }}>
                    Import from Excel
                  </MenuItem>
                  <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { close(); void downloadTemplate() }}>Download Excel template</MenuItem>
                  <div className="my-1 h-px bg-slate-100" />
                  <MenuItem icon={<RefreshCw className="h-4 w-4" />} onClick={() => { close(); void load() }}>Refresh</MenuItem>
                </>
              )}
            </Menu>
            <input autoComplete="off" ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { void handleImport(f); e.target.value = "" } }} />
            <button aria-label="Add record"
              onClick={() => { setEditingRecord(null); setFormOpen(true) }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add record</span>
            </button>
          </div>
        </div>

        {/* ── At a glance: total, the biggest groups, how spread ─────── */}
        {!loading && records.length > 0 && stats.length > 1 && (
          <div className="flex gap-2.5 overflow-x-auto px-4 pb-3 sm:px-6 [scrollbar-width:none]">
            {stats.map((c) => {
              const active = !!c.filter && filters[c.filter.field_key]?.kind === "choice" && (filters[c.filter.field_key] as { value: string }).value === c.filter.value
              const tone = {
                total: "bg-primary/10 text-primary",
                a: "bg-emerald-50 text-emerald-700",
                b: "bg-amber-50 text-amber-700",
                c: "bg-violet-50 text-violet-700",
              }[c.tone]
              const Icon = c.tone === "total" ? Users : c.tone === "c" ? MapPin : Calendar
              const body = (
                <>
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone)}><Icon className="h-4.5 w-4.5" aria-hidden /></span>
                  <span className="min-w-0 text-left">
                    <span className="block text-[18px] font-semibold leading-tight tabular-nums text-slate-900">{c.value}</span>
                    <span className="block max-w-[140px] truncate text-[11.5px] text-slate-500" title={c.label}>{c.label}</span>
                  </span>
                </>
              )
              return c.filter ? (
                <button key={c.key} type="button" aria-pressed={active}
                  onClick={() => setQuick(c.filter!.field_key, active ? null : c.filter!.value)}
                  title={active ? "Show all again" : `Show only ${c.label}`}
                  className={cn("flex min-w-[148px] shrink-0 items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-all hover:-translate-y-px hover:shadow-sm",
                    active ? "border-primary/40 bg-primary/5 ring-2 ring-primary/15" : "border-slate-200 bg-white")}>
                  {body}
                </button>
              ) : (
                <div key={c.key} className="flex min-w-[148px] shrink-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">{body}</div>
              )
            })}
          </div>
        )}

        {/* ── Tool row, or what to do with the selected rows ────────── */}
        {selectedIds.size > 0 ? (
          <div className="flex h-12 items-center gap-3 border-t border-slate-100 bg-primary/5 px-4 sm:px-6">
            <span className="text-[13px] font-medium text-slate-800">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-[12.5px] text-slate-500 hover:text-slate-800">Clear</button>
            <div className="flex-1" />
            <button
              onClick={() => exportCsv(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden /> Export
            </button>
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkDeleting}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-[12.5px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 sm:px-6">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="records-search"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records…"
                aria-label="Search records"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-[13px] outline-none transition focus:border-primary/50 focus:bg-white focus:ring-2 focus:ring-primary/15"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {quick.map((f) => {
              const cur = filters[f.field_key]
              const value = cur?.kind === "choice" ? cur.value : "__all__"
              const opts = optionsFor(f, searched, fields, filters)
              return (
                <Select key={f.field_key} value={value} onValueChange={(v) => setQuick(f.field_key, !v || v === "__all__" ? null : String(v))}>
                  <SelectTrigger aria-label={`Filter by ${f.label}`}
                    className={cn("h-9 w-auto min-w-[128px] max-w-[200px] rounded-lg text-left text-[12.5px]", value !== "__all__" ? "border-primary/40 bg-primary/5 text-primary" : "border-slate-200 bg-white")}>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{f.label}</span>
                      <span className="truncate"><SelectValue /></span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label} ({o.count})</SelectItem>)}
                  </SelectContent>
                </Select>
              )
            })}

            {canFilter && (
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors",
                  activeFilters > 0 || filtersOpen ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filter
                {activeFilters > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{activeFilters}</span>
                )}
              </button>
            )}

            {presentSources.length > 1 && (
              <Menu label={sourceFilter ? sourceLabel(sourceFilter) : "Source"} icon={<ListChecks className="h-3.5 w-3.5" />} active={!!sourceFilter} width="w-52">
                {(close) => (
                  <>
                    {[{ key: "", label: "All sources" }, ...presentSources.map((s) => ({ key: s, label: RECORD_SOURCE_LABELS[s] }))].map((o) => (
                      <button key={o.key || "all"} type="button" onClick={() => { setSourceFilter(o.key); close() }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                        {o.label}
                        {sourceFilter === o.key && <Check className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    ))}
                  </>
                )}
              </Menu>
            )}

            <div className="flex-1" />

            <div className="flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="View">
              {([["table", "Table", Table2], ["cards", "Cards", LayoutGrid]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={prefs.view === v} aria-label={label} title={label} onClick={() => updatePrefs({ view: v })}
                  className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                    prefs.view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                  <Icon className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportCsv(false)}
              disabled={sorted.length === 0}
              title="Download the rows shown as a CSV file (opens in Excel)"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Export</span>
            </button>

            <Menu label="Columns" iconOnly icon={<Columns3 className="h-3.5 w-3.5" />} badge={prefs.hidden.length || undefined} align="right" width="w-64">
              {() => (
                <div className="max-h-80 overflow-y-auto">
                  <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Show columns</p>
                  {[
                    ...columnFields.map((f) => ({ key: f.field_key, label: f.label })),
                    ...(hasCustomers ? [{ key: SYS.customer, label: "Customer" }] : []),
                    { key: SYS.source, label: "Source" },
                    { key: SYS.added, label: "Added" },
                  ].map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} className="h-4 w-4 accent-[var(--primary)]" />
                      <span className="truncate">{c.label}</span>
                    </label>
                  ))}
                  {prefs.hidden.length > 0 && (
                    <button type="button" onClick={() => updatePrefs({ hidden: [] })}
                      className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium text-primary hover:bg-primary/5">
                      Show all
                    </button>
                  )}
                </div>
              )}
            </Menu>
            <button
              type="button"
              onClick={() => updatePrefs({ density: prefs.density === "compact" ? "comfortable" : "compact" })}
              title={prefs.density === "compact" ? "Roomier rows" : "Compact rows"}
              aria-label={prefs.density === "compact" ? "Roomier rows" : "Compact rows"}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {prefs.density === "compact" ? <Rows3 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />}
            </button>
          </div>
        )}

        {filtersOpen && canFilter && selectedIds.size === 0 && (
          <RecordFilters
            fields={fields}
            records={searched}
            allRecords={records}
            filters={filters}
            onChange={setFilters}
            matchCount={filtered.length}
            totalCount={searched.length}
          />
        )}
      </header>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <TableSkeleton />
          ) : columnFields.length === 0 ? (
            <EmptyState
              icon={<Settings2 className="h-6 w-6" />}
              title="No fields yet"
              text="Add the columns this table should hold — name, phone, course… — then add records or share a form."
              action="Add fields"
              onAction={() => void openFieldPanel()}
            />
          ) : records.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-6 w-6" />}
              title="No records yet"
              text="Add one here, import an Excel sheet from the ⋯ menu, or share a form and let people fill it in."
              action="Add record"
              onAction={() => { setEditingRecord(null); setFormOpen(true) }}
            />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="Nothing matches"
              text="No record fits this search and these filters."
              action={activeFilters > 0 || sourceFilter ? "Clear search and filters" : "Clear search"}
              onAction={() => { setSearch(""); setFilters({}); setSourceFilter("") }}
            />
          ) : (
            <>
              {prefs.view === "cards" ? (
                <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60 p-3">
                  {pageRecords.length > 0 && (
                    <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 px-1 text-[12px] text-slate-500">
                      <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} className="h-4 w-4 accent-[var(--primary)]" />
                      Select all on this page
                    </label>
                  )}
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {pageRecords.map((rec) => {
                      const data = rec.data as Record<string, unknown>
                      const selected = selectedIds.has(rec.id)
                      const sub = subField ? formatValue(subField, data[subField.field_key]) : ""
                      const chipsHere = shownFields.filter((f) => chipKeys.has(f.field_key) && formatValue(f, data[f.field_key])).slice(0, 3)
                      const facts = shownFields
                        .filter((f) => f.field_key !== titleField?.field_key && f.field_key !== subField?.field_key && !chipKeys.has(f.field_key) && formatValue(f, data[f.field_key]))
                        .slice(0, 4)
                      return (
                        <li key={rec.id} className={cn("group relative min-w-0 rounded-2xl border bg-white p-3.5 shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                          selected ? "border-primary/40 ring-2 ring-primary/15" : "border-slate-200")}>
                          <input type="checkbox" checked={selected} onChange={() => toggleSelectOne(rec.id)} aria-label="Select this record"
                            className="absolute right-3 top-3 h-4 w-4 cursor-pointer accent-[var(--primary)]" />
                          <button type="button" onClick={() => setViewingRecord(rec)} className="block w-full min-w-0 text-left">
                            <span className="flex min-w-0 items-center gap-2.5 pr-6">
                              {nameCell(rec)}
                            </span>
                            {sub && <span className="mt-1 block truncate pl-[42px] text-[12px] text-slate-500">{sub}</span>}
                            {chipsHere.length > 0 && (
                              <span className="mt-2.5 flex flex-wrap gap-1">{chipsHere.map((f) => <span key={f.field_key}>{chip(f, data[f.field_key])}</span>)}</span>
                            )}
                            {facts.length > 0 && (
                              <span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5">
                                {facts.map((f) => (
                                  <span key={f.field_key} className="min-w-0">
                                    <span className="block truncate text-[10.5px] text-slate-400">{f.label}</span>
                                    <span className="block truncate text-[12.5px] text-slate-700">{formatValue(f, data[f.field_key])}</span>
                                  </span>
                                ))}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-separate border-spacing-0 text-[13px]">
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 top-0 z-20 w-11 border-b border-slate-200 bg-slate-50 pl-4 pr-2 text-left">
                        <input
                          autoComplete="off"
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 cursor-pointer rounded accent-[var(--primary)] align-middle"
                          aria-label="Select all rows on this page"
                        />
                      </th>
                      {shownFields.map((f) => headerCell(f.field_key, f.label, FIELD_TYPE_ICONS[f.field_type] ?? Type))}
                      {showCustomer && headerCell(SYS.customer, "Customer")}
                      {showSource && headerCell(SYS.source, "Source")}
                      {showAdded && headerCell(SYS.added, "Added")}
                      <th scope="col" className="sticky right-0 top-0 z-20 w-20 border-b border-slate-200 bg-slate-50 px-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRecords.map((rec) => {
                      const data = rec.data as Record<string, unknown>
                      const selected = selectedIds.has(rec.id)
                      const solid = selected ? "bg-[color-mix(in_oklab,var(--primary)_6%,white)]" : "bg-white group-hover:bg-slate-50"
                      return (
                        <tr key={rec.id} className={cn("group", selected && "bg-[color-mix(in_oklab,var(--primary)_6%,white)]")}>
                          <td className={cn("sticky left-0 z-10 w-11 border-b border-slate-100 pl-4 pr-2", cellY, solid)}>
                            <input
                              autoComplete="off"
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelectOne(rec.id)}
                              className="h-4 w-4 cursor-pointer rounded accent-[var(--primary)] align-middle"
                              aria-label="Select this record"
                            />
                          </td>
                          {shownFields.map((f) => {
                            const text = formatValue(f, data[f.field_key])
                            const mono = f.field_type === "phone" || f.field_type === "email" || f.field_type === "url"
                            return (
                              <td
                                key={f.id}
                                onClick={() => setViewingRecord(rec)}
                                className={cn("max-w-[260px] cursor-pointer border-b border-slate-100 px-3 text-slate-700", cellY, selected ? "" : "group-hover:bg-slate-50")}
                              >
                                {titleField && f.field_key === titleField.field_key ? (
                                  nameCell(rec)
                                ) : chipKeys.has(f.field_key) ? (
                                  chip(f, data[f.field_key])
                                ) : f.field_type === "boolean" && text ? (
                                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium", data[f.field_key] ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                                    {text}
                                  </span>
                                ) : text ? (
                                  <span title={text.length > 30 ? text : undefined} className={cn("block truncate", mono && "tabular-nums text-slate-600", f.field_type === "number" && "tabular-nums")}>
                                    {text}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            )
                          })}
                          {showCustomer && (
                            <td onClick={() => setViewingRecord(rec)} className={cn("cursor-pointer whitespace-nowrap border-b border-slate-100 px-3", cellY, selected ? "" : "group-hover:bg-slate-50")}>
                              {rec.contact ? (
                                <span className="flex max-w-[220px] items-center gap-2" title={rec.contact.phone}>
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                    {(rec.contact.name || rec.contact.phone).trim().charAt(0).toUpperCase()}
                                  </span>
                                  <span className="truncate text-slate-700">{rec.contact.name || rec.contact.phone}</span>
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          )}
                          {showSource && (
                            <td onClick={() => setViewingRecord(rec)} className={cn("cursor-pointer whitespace-nowrap border-b border-slate-100 px-3", cellY, selected ? "" : "group-hover:bg-slate-50")}>
                              {isRecordSource(rec.source) ? (
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium", SOURCE_STYLE[rec.source])}>
                                  {RECORD_SOURCE_LABELS[rec.source]}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          )}
                          {showAdded && (
                            <td
                              onClick={() => setViewingRecord(rec)}
                              title={rec.updated_at !== rec.created_at ? `Updated ${stamp(rec.updated_at)}` : undefined}
                              className={cn("cursor-pointer whitespace-nowrap border-b border-slate-100 px-3 text-[12.5px] tabular-nums text-slate-500", cellY, selected ? "" : "group-hover:bg-slate-50")}
                            >
                              {stamp(rec.created_at)}
                            </td>
                          )}
                          <td className={cn("sticky right-0 z-10 w-20 border-b border-slate-100 px-2 shadow-[-12px_0_12px_-12px_rgba(15,23,42,0.18)]", cellY, solid)}>
                            <div className="flex items-center justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                              <button
                                onClick={() => { setEditingRecord(rec); setFormOpen(true) }}
                                aria-label="Edit record"
                                title="Edit"
                                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmRecordId(rec.id)}
                                aria-label="Delete record"
                                title="Delete"
                                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {/* ── Footer ─────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2">
                <p className="text-[12px] text-slate-500">
                  <span className="tabular-nums">{firstShown}–{lastShown}</span> of <span className="tabular-nums">{sorted.length}</span>
                  {sorted.length !== records.length && <span className="text-slate-400"> (filtered from {records.length})</span>}
                  {total > records.length && <span className="text-slate-400"> · newest {records.length} of {total} loaded</span>}
                </p>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
                    Rows
                    <select
                      id="page-size"
                      value={pageSize}
                      onChange={(e) => updatePrefs({ pageSize: Number(e.target.value) })}
                      className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 outline-none focus:border-primary/50"
                    >
                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  {pageCount > 1 && (
                    <nav className="flex items-center gap-1" aria-label="Pages">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} aria-label="Previous page"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {pageList(currentPage, pageCount).map((n, i) => n === "…" ? (
                        <span key={`gap-${i}`} className="px-1 text-[12px] text-slate-400">…</span>
                      ) : (
                        <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === currentPage ? "page" : undefined}
                          className={cn("h-8 min-w-8 rounded-lg px-2 text-[12.5px] font-medium tabular-nums transition-colors",
                            n === currentPage ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:bg-slate-100")}>
                          {n}
                        </button>
                      ))}
                      <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage >= pageCount} aria-label="Next page"
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-30">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </nav>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {formOpen && (
        <RecordForm
          open={formOpen}
          tableId={tableId}
          fields={fields}
          record={editingRecord}
          rules={linkConfig.rules}
          autoLink={linkConfig.auto_link}
          onClose={() => { setFormOpen(false); setEditingRecord(null) }}
          onSaved={() => { setFormOpen(false); setEditingRecord(null); load() }}
        />
      )}

      {viewingRecord && (
        <RecordDetailModal
          record={viewingRecord}
          fields={fields}
          chipKeys={chipKeys}
          onClose={() => setViewingRecord(null)}
          onEdit={() => {
            setEditingRecord(viewingRecord)
            setViewingRecord(null)
            setFormOpen(true)
          }}
          onDelete={() => {
            setConfirmRecordId(viewingRecord.id)
            setViewingRecord(null)
          }}
        />
      )}

      {fieldPanelOpen && (
        <SidePanel
          title="Fields & AI registration"
          subtitle={`${columnFields.length} field${columnFields.length !== 1 ? "s" : ""} · ${table?.name ?? ""}`}
          icon={<Settings2 className="h-4.5 w-4.5" />}
          onClose={() => setFieldPanelOpen(false)}
        >
          <LinkedFieldsCard
            tableId={tableId}
            fields={fields}
            onRulesChange={(config) => setTable((t) => (t ? { ...t, form_config: config } : t))}
          />
          {table && (
            <AiRegistrationToggle
              tableId={tableId}
              table={table}
              fields={fields}
              onChange={(patch) => setTable((t) => (t ? { ...t, ...patch } : t))}
            />
          )}
          <FieldEditor
            tableId={tableId}
            fields={fields}
            allTables={allTables}
            onFieldsChange={(updated) => setFields(updated)}
          />
        </SidePanel>
      )}

      {healthOpen && table && (
        <DataHealthPanel tableId={tableId} tableName={table.name} onClose={() => setHealthOpen(false)} onChanged={() => void load()} />
      )}

      {sheetOpen && table && (
        <GoogleSheetPanel tableId={tableId} tableName={table.name} onClose={() => setSheetOpen(false)} onImported={() => void load()} />
      )}

      {routingOpen && table && (
        <SheetRoutingPanel tableId={tableId} tableName={table.name} onClose={() => setRoutingOpen(false)} />
      )}

      {alertsOpen && table && (
        <RecordAlertsPanel tableId={tableId} tableName={table.name} fields={fields} onClose={() => setAlertsOpen(false)} />
      )}

      {formPanelOpen && table && (
        <PublicFormPanel tableId={tableId} tableName={table.name} fields={fields} onClose={() => setFormPanelOpen(false)} />
      )}

      <ConfirmDialog
        open={!!confirmRecordId}
        title="Delete record?"
        description="This record will be permanently deleted and cannot be recovered."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmRecordId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} record${selectedIds.size !== 1 ? "s" : ""}?`}
        description="These records will be permanently deleted and cannot be recovered."
        confirmLabel="Delete"
        onConfirm={confirmBulkDeleteRecords}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}

function TableSkeleton() {
  return (
    <div>
      <div className="h-10 border-b border-slate-200 bg-slate-50" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-6 border-b border-slate-100 px-4">
          <div className="h-3.5 w-3.5 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  icon, title, text, action, onAction,
}: { icon: React.ReactNode; title: string; text: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span>
      <h3 className="mt-4 text-[15px] font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{text}</p>
      <button
        onClick={onAction}
        className="mt-5 flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary/90"
      >
        {action}
      </button>
    </div>
  )
}
