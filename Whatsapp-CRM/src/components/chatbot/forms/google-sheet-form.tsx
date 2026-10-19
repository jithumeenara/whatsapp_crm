"use client";

/**
 * The chatbot's "Google Sheet" step — add, update or delete rows straight
 * in a Google Sheet (src/lib/google/sheet-step.ts runs it).
 *
 *  - A sheet is chosen from the account's Google Drive, or created here
 *    with its header row; Google is connected in a pop-up when needed.
 *  - "Map columns" opens a dialog: every sheet column on the left, what to
 *    write on the right — a searchable list of this chat's details, the
 *    chatbot's answers, the trigger, today/now, or custom text. Something
 *    already used is not offered again (except today, now and text).
 *  - Find rows: column + comparison + value, AND/OR; latest/oldest/all,
 *    "latest" by a date column or by position; delete archives by default.
 *  - Test: the step against the real sheet with sample values, writing
 *    nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Check, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GoogleSheetChooser } from "@/components/shared/google-sheet-chooser";
import { GoogleSheetsIcon } from "@/components/shared/google-icons";
import { apiFetch, errorText } from "@/lib/api-fetch";
import { connectGoogle } from "@/lib/google/connect-popup";
import { autoMatch, CLEAR_TOKEN, type MatchOption } from "@/lib/google/sheet-rows";
import { cn } from "@/lib/utils";

type Cfg = Record<string, unknown>;
type Op = "equals" | "phone" | "contains" | "empty" | "not_empty";
interface Mapping { column: string; value: string }
interface Cond { column: string; op: Op; value: string }

interface Preview {
  id: string;
  title: string;
  tabs: Array<{ title: string; rows: number }>;
  tab: string;
  headers: string[];
  sample: string[][];
  total_rows: number;
  dropdowns: Record<string, string[]>;
  can_write?: boolean;
}

const OPS: Array<{ value: Op; label: string }> = [
  { value: "equals", label: "is" },
  { value: "phone", label: "is the same phone number as" },
  { value: "contains", label: "contains" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
];

export interface ValueOption {
  value: string;
  label: string;
  group: string;
  keys?: string[];
  /** May be used for more than one column. */
  repeatable?: boolean;
}

/** Everything the step can write, in the order people look for it. */
export function valueOptions(vars: readonly string[], forUpdate: boolean): ValueOption[] {
  const out: ValueOption[] = [
    { value: "{{contact.name}}", label: "Contact name", group: "This chat", keys: ["name", "customer name"] },
    { value: "{{contact.phone}}", label: "Contact phone", group: "This chat", keys: ["phone", "mobile", "whatsapp"] },
    { value: "{{contact.email}}", label: "Contact email", group: "This chat", keys: ["email"] },
    { value: "{{contact.company}}", label: "Contact company", group: "This chat", keys: ["company"] },
  ];
  const trigger = ["trigger_message", "trigger_type", "trigger_channel"];
  for (const v of vars) {
    if (trigger.includes(v)) continue;
    out.push({ value: `{{vars.${v}}}`, label: v.replace(/_/g, " "), group: "Chatbot answers", keys: [v] });
  }
  out.push(
    { value: "{{vars.trigger_message}}", label: "Message that started the chat", group: "Trigger", keys: ["message", "trigger message"] },
    { value: "{{vars.trigger_channel}}", label: "Channel (WhatsApp, Instagram…)", group: "Trigger", keys: ["channel", "source"] },
    { value: "{{today}}", label: "Today’s date", group: "Date & time", keys: ["date", "today"], repeatable: true },
    { value: "{{now}}", label: "Date and time now", group: "Date & time", keys: ["time", "timestamp", "created at"], repeatable: true },
  );
  if (forUpdate) out.push({ value: CLEAR_TOKEN, label: "Make the cell empty", group: "Other", repeatable: true });
  return out;
}

function readMapping(cfg: Cfg): Mapping[] {
  return Array.isArray(cfg.mapping)
    ? (cfg.mapping as Array<Record<string, unknown>>).map((m) => ({ column: String(m.column ?? ""), value: String(m.value ?? "") }))
    : [];
}
function readConds(cfg: Cfg): Cond[] {
  return Array.isArray(cfg.conditions)
    ? (cfg.conditions as Array<Record<string, unknown>>).map((c) => ({ column: String(c.column ?? ""), op: (String(c.op ?? "equals") as Op), value: String(c.value ?? "") }))
    : [];
}

function Segmented<T extends string>({ value, options, onChange, label, cols }: {
  value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void; label: string; cols?: number;
}) {
  return (
    <div className={cn("grid gap-1 rounded-xl bg-slate-100 p-1", cols === 2 ? "grid-cols-2" : "grid-cols-3")} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn(
            "rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            value === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-slate-700">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** What to write in one column: a searchable list, or custom text. */
function ValuePicker({ value, options, usedElsewhere, onChange, label, choices }: {
  value: string;
  options: ValueOption[];
  usedElsewhere: Set<string>;
  onChange: (v: string) => void;
  label: string;
  /** The sheet's own dropdown choices for this column. */
  choices?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const known = options.find((o) => o.value === value);
  const [custom, setCustom] = useState(!!value && !known);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = options.filter((o) =>
    (o.repeatable || o.value === value || !usedElsewhere.has(o.value)) &&
    (!q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
  );
  const groups = [...new Set(visible.map((o) => o.group))];
  const pick = (v: string, asCustom = false) => {
    setCustom(asCustom);
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  if (custom) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Input className="h-8 min-w-0 flex-1 text-xs" value={value} autoFocus autoComplete="off" aria-label={`${label}: custom text`}
          placeholder="Type text — {{vars.x}} works too" onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => { setCustom(false); onChange(""); }} aria-label={`${label}: choose from the list instead`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setQuery(""); }}>
      <PopoverTrigger
        aria-label={`${label}: what to write`}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border px-2 text-left text-xs transition-colors hover:border-slate-300",
          value ? "border-slate-200 bg-white text-slate-800" : "border-dashed border-slate-300 bg-slate-50 text-slate-400",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{known ? known.label : value || "Leave empty"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 focus-within:bg-indigo-50/50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-300">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <input ref={searchRef} name="value-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search answers, contact, date…"
            aria-label="Search values" autoComplete="off"
            className="w-full bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none" />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {choices && choices.length > 0 && !q && (
            <div>
              <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">The sheet’s choices</p>
              {choices.slice(0, 20).map((c) => (
                <button key={c} type="button" onClick={() => pick(c, true)} className="flex w-full items-center px-3 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50">{c}</button>
              ))}
            </div>
          )}
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              {visible.filter((o) => o.group === g).map((o) => (
                <button key={o.value} type="button" onClick={() => pick(o.value)}
                  className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50", o.value === value && "bg-indigo-50/60")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-slate-700">{o.label}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-400">{o.value}</span>
                  </span>
                  {o.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden />}
                </button>
              ))}
            </div>
          ))}
          {visible.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-slate-400">Nothing matches. Use custom text.</p>}
        </div>
        <div className="flex gap-1 border-t border-slate-100 p-1.5">
          <button type="button" onClick={() => pick("", true)} className="flex-1 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-indigo-700 hover:bg-indigo-50">Custom text…</button>
          {value && <button type="button" onClick={() => pick("")} className="rounded-md px-2 py-1.5 text-[12px] text-slate-500 hover:bg-slate-100">Leave empty</button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Sheet column ← value, for every column: the mapping dialog. */
function MappingDialog({ open, onClose, headers, sample, dropdowns, mapping, options, onSave, forUpdate }: {
  open: boolean;
  onClose: () => void;
  headers: string[];
  sample: string[][];
  dropdowns: Record<string, string[]>;
  mapping: Mapping[];
  options: ValueOption[];
  onSave: (m: Mapping[]) => void;
  forUpdate: boolean;
}) {
  // Mounted only while open, so each opening starts from what is saved.
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(mapping.map((m) => [m.column, m.value])));
  const [extra, setExtra] = useState<string[]>(() =>
    mapping.map((m) => m.column).filter((c) => !headers.some((h) => h.trim().toLowerCase() === c.trim().toLowerCase())));
  const [newCol, setNewCol] = useState("");

  const columns = [...headers.filter((h) => h.trim().toLowerCase() !== "crm id"), ...extra];
  const mappedCount = columns.filter((c) => (draft[c] ?? "").trim()).length;
  const usedBy = (col: string) => new Set(Object.entries(draft).filter(([c, v]) => c !== col && v).map(([, v]) => v));
  const sampleOf = (i: number) => sample.find((r) => (r[i] ?? "").trim())?.[i] ?? "";
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label;

  function runAutoMatch() {
    const opts: MatchOption[] = options.filter((o) => o.value !== CLEAR_TOKEN).map((o) => ({ value: o.value, label: o.label, keys: o.keys }));
    const empty = columns.filter((c) => !(draft[c] ?? "").trim());
    const taken = new Set(Object.values(draft).filter(Boolean));
    const guess = autoMatch(empty, opts.filter((o) => !taken.has(o.value) || options.find((x) => x.value === o.value)?.repeatable));
    const n = Object.keys(guess).length;
    setDraft((d) => ({ ...d, ...guess }));
    if (n) toast.success(`Matched ${n} column${n === 1 ? "" : "s"} — check them before saving.`);
    else toast.message("No obvious matches. Choose them yourself.");
  }

  function addColumn() {
    const c = newCol.trim().slice(0, 100);
    if (!c) return;
    if (columns.some((x) => x.toLowerCase() === c.toLowerCase())) { toast.error("That column is already there."); return; }
    setExtra((e) => [...e, c]);
    setNewCol("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Map columns</DialogTitle>
          <DialogDescription>
            {forUpdate
              ? "What to write into each column of the matching row. Columns left empty are not touched."
              : "What goes into each column of the new row. Columns are matched by name, so moving them in the sheet is fine."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={runAutoMatch}><Wand2 aria-hidden /> Auto-match</Button>
          <span className="text-[12px] tabular-nums text-slate-500">{mappedCount} of {columns.length} mapped</span>
          {mappedCount > 0 && (
            <button type="button" onClick={() => setDraft({})} className="ml-auto text-[12px] text-slate-500 hover:text-slate-800 hover:underline">Clear all</button>
          )}
        </div>

        <div className="max-h-[50dvh] min-w-0 overflow-y-auto rounded-xl border border-slate-200">
          {columns.length === 0 ? (
            <p className="p-4 text-[13px] text-slate-500">This sheet has no header row yet. Add the columns below — the first row is written for you.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {columns.map((col) => {
                const i = headers.indexOf(col);
                const s = i >= 0 ? sampleOf(i) : "";
                return (
                  <li key={col} className="grid grid-cols-1 items-center gap-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-800">{col}</p>
                      <p className="truncate text-[11px] text-slate-400">{i < 0 ? "New column" : s ? `e.g. ${s}` : "Empty so far"}</p>
                    </div>
                    <ValuePicker label={col} value={draft[col] ?? ""} options={options} usedElsewhere={usedBy(col)}
                      choices={i >= 0 ? dropdowns[String(i)] : undefined}
                      onChange={(v) => setDraft((d) => ({ ...d, [col]: v }))} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addColumn(); }}>
          <Input value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="Add a column the sheet does not have yet" aria-label="New column name" autoComplete="off" className="h-8 text-xs" />
          <Button type="submit" variant="outline" size="sm" disabled={!newCol.trim()}><Plus aria-hidden /> Add</Button>
        </form>

        {mappedCount > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-slate-500">Preview of the row</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-[11.5px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>{columns.filter((c) => draft[c]).map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    {columns.filter((c) => draft[c]).map((c) => (
                      <td key={c} className="whitespace-nowrap px-2 py-1 text-slate-700">
                        {labelOf(draft[c]) ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{labelOf(draft[c])}</span> : draft[c]}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => {
            onSave(columns.filter((c) => (draft[c] ?? "").trim()).map((c) => ({ column: c, value: draft[c] })));
            onClose();
          }}>Save mapping</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create a new spreadsheet, header row included. */
function CreateSheetForm({ defaultHeaders, onCreated, onCancel }: {
  defaultHeaders: string[];
  onCreated: (s: { id: string; name: string; tab: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Chatbot leads");
  const [headers, setHeaders] = useState(defaultHeaders.join(", "));
  const [busy, setBusy] = useState(false);
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/google/sheets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, tab: "Sheet1", headers: headers.split(",").map((h) => h.trim()).filter(Boolean) }),
      });
      const d = (await res.json()) as { id?: string; name?: string; tab?: string; needs_write?: boolean };
      if (d.needs_write) {
        connectGoogle(`/api/google/connect?services=sheets_sync&return=${encodeURIComponent(window.location.pathname)}`, (r) => {
          if (r.outcome === "connected") toast.success("Google Sheets allowed — press Create again.");
          else if (r.outcome === "error") toast.error(r.reason || "Google was not connected.");
        });
        return;
      }
      if (!d.id) throw new Error("Google did not return the new sheet.");
      toast.success(`“${d.name}” created in your Google Drive`);
      onCreated({ id: d.id, name: d.name ?? name, tab: d.tab ?? "Sheet1" });
    } catch (err) {
      console.error("[google-sheet-step] create failed:", err);
      toast.error(errorText(err, "Could not create the sheet"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-600">Sheet name</span>
        <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-600">Columns (comma separated)</span>
        <Input className="h-8 text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} autoComplete="off" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin" aria-hidden />} Create sheet</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function GoogleSheetForm({ cfg, onChange, vars, activity }: {
  cfg: Cfg;
  onChange: (c: Cfg) => void;
  vars: string[];
  activity?: React.ReactNode;
}) {
  const spreadsheetId = String(cfg.spreadsheet_id ?? "");
  const tab = String(cfg.sheet_title ?? "");
  const action = (cfg.action === "update" || cfg.action === "delete" ? cfg.action : "add") as "add" | "update" | "delete";
  const addMode = (cfg.add_mode === "if_missing" || cfg.add_mode === "upsert" ? cfg.add_mode : "always") as "always" | "if_missing" | "upsert";
  const which = (cfg.which === "oldest" || cfg.which === "all" ? cfg.which : "latest") as "latest" | "oldest" | "all";
  const match = cfg.match === "any" ? "any" : "all";
  const deleteMode = cfg.delete_mode === "delete" ? "delete" : "archive";
  const dateColumn = String(cfg.date_column ?? "");
  const olderThan = Math.max(0, Number(cfg.older_than_days) || 0);
  const mapping = readMapping(cfg);
  const conds = readConds(cfg);
  const needsFind = action !== "add" || addMode !== "always";

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ tone: "ok" | "warn" | "bad"; text: string; rows?: string[] } | null>(null);
  const seq = useRef(0);

  const options = useMemo(() => valueOptions(vars, action === "update" || addMode === "upsert"), [vars, action, addMode]);
  const headers = preview?.headers ?? [];

  const load = useCallback(async (id: string, t: string) => {
    if (!id) return;
    const n = ++seq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/google/sheets/preview?picked=1&spreadsheet=${encodeURIComponent(id)}${t ? `&tab=${encodeURIComponent(t)}` : ""}`);
      const d = (await res.json()) as Preview & { api_disabled?: { enable_url: string } };
      if (d.api_disabled) throw new Error("The Google Sheets API is switched off in your Google Cloud project. Turn it on in Settings → Google.");
      if (n === seq.current) setPreview(d);
    } catch (err) {
      console.error("[google-sheet-step] preview failed:", err);
      if (n === seq.current) { setPreview(null); setLoadError(errorText(err, "Could not open that sheet")); }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);

  // Read the sheet when the step opens, or another sheet/tab is chosen.
  useEffect(() => {
    if (!spreadsheetId) return;
    const t = setTimeout(() => void load(spreadsheetId, tab), 0);
    return () => clearTimeout(t);
  }, [spreadsheetId, tab, load]);

  // The first tab once the sheet is read, when none was chosen.
  useEffect(() => {
    if (preview && !tab && preview.tab) onChange({ ...cfg, sheet_title: preview.tab, spreadsheet_name: preview.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  function chooseSheet(id: string, name: string, t = "") {
    setPreview(null);
    setTestResult(null);
    onChange({ ...cfg, spreadsheet_id: id, spreadsheet_name: name, sheet_title: t, mapping: [], conditions: [], date_column: "" });
  }

  function setConds(next: Cond[]) {
    setTestResult(null);
    onChange({ ...cfg, conditions: next });
  }
  function condAt(i: number, patch: Partial<Cond>) {
    setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  // A sheet with a phone-ish column: "Phone is this customer" to start with.
  useEffect(() => {
    if (!preview || !needsFind || conds.length > 0) return;
    const phone = preview.headers.find((h) => /phone|mobile|whatsapp|contact no|number/i.test(h));
    if (phone) onChange({ ...cfg, conditions: [{ column: phone, op: "phone", value: "{{contact.phone}}" }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, needsFind]);

  const tokens = useMemo(() => {
    const all = [...(needsFind ? conds.map((c) => c.value) : []), ...(action !== "delete" ? mapping.map((m) => m.value) : [])].join(" ");
    return [...new Set(all.match(/\{\{[^}]+\}\}/g) ?? [])].filter((t) => !/^\{\{(today|now|clear)\}\}$/i.test(t));
  }, [conds, mapping, needsFind, action]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  async function test() {
    if (testing || !spreadsheetId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch("/api/google/sheets/step-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg, samples }),
      });
      const d = (await res.json()) as {
        outcome: string; found: number; reason: string | null; warnings: string[];
        rows: Array<{ row: number; before?: Record<string, string>; after?: Record<string, string> }>;
      };
      const show = (o?: Record<string, string>) => Object.entries(o ?? {}).filter(([, v]) => v).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ");
      const rows = d.rows.map((r) => `${r.row ? `Row ${r.row} — ` : ""}${show(r.after ?? r.before)}`);
      const n = d.found;
      const text =
        d.outcome === "added" ? (addMode === "always" ? "Would add this row:" : `No matching row — would add:`)
        : d.outcome === "exists" ? `Already there (${n} match${n === 1 ? "" : "es"}) — would NOT add again. Goes to ✓ Done.`
        : d.outcome === "updated" ? `${n} row${n === 1 ? "" : "s"} match. Would update ${d.rows.length}:`
        : d.outcome === "deleted" ? `${n} row${n === 1 ? "" : "s"} match. Would ${deleteMode === "archive" ? "move to “Deleted”" : "delete"} ${d.rows.length}:`
        : `${d.reason ?? "No row matched."} Goes to ✗ Not found.`;
      setTestResult({ tone: d.outcome === "not_found" ? "warn" : "ok", text: [text, ...d.warnings.map((w) => `⚠ ${w}`)].join("\n"), rows });
    } catch (err) {
      console.error("[google-sheet-step] test failed:", err);
      setTestResult({ tone: "bad", text: errorText(err, "Test failed") });
    } finally {
      setTesting(false);
    }
  }

  const summary = (() => {
    if (!spreadsheetId || !tab) return null;
    const where = conds.filter((c) => c.column).map((c) => {
      const op = OPS.find((o) => o.value === c.op)?.label ?? "is";
      return c.op === "empty" || c.op === "not_empty" ? `${c.column} ${op}` : `${c.column} ${op} ${c.value === "{{contact.phone}}" ? "the customer’s number" : `“${labelOf(c.value)}”`}`;
    }).join(match === "any" ? " or " : " and ");
    const rowWords = which === "all" ? "every matching row (up to 20)" : `the ${which} matching row`;
    const by = dateColumn ? ` by “${dateColumn}”` : "";
    if (action === "add") {
      const base = `Adds a row to “${tab}” with ${mapping.length} column${mapping.length === 1 ? "" : "s"} filled.`;
      if (addMode === "if_missing") return `${base} Skipped when a row where ${where || "…"} is already there.`;
      if (addMode === "upsert") return `Updates the latest row where ${where || "…"}; adds a new row when there is none.`;
      return base;
    }
    if (action === "update") return `Updates ${rowWords}${which === "all" ? "" : by} where ${where || "…"}.`;
    const age = olderThan > 0 ? ` older than ${olderThan} day${olderThan === 1 ? "" : "s"} (by “${dateColumn || "?"}”)` : "";
    return `${deleteMode === "archive" ? "Moves" : "Deletes"} ${rowWords}${age} where ${where || "…"}${deleteMode === "archive" ? " to the “Deleted” tab — restorable" : " — permanently"}.`;
  })();

  return (
    <div className="space-y-5">
      {/* Sheet */}
      <Section title="Google Sheet">
        {!spreadsheetId ? (
          creating ? (
            <CreateSheetForm defaultHeaders={["Date", "Name", "Phone", "Message"]} onCancel={() => setCreating(false)}
              onCreated={(s) => { setCreating(false); chooseSheet(s.id, s.name, s.tab); }} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setChoosing(true)}
                className="flex flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/40">
                <GoogleSheetsIcon className="h-5 w-5" />
                <span className="text-[12px] font-semibold text-slate-800">Choose a sheet</span>
                <span className="text-[10.5px] text-slate-500">From your Google Drive</span>
              </button>
              <button type="button" onClick={() => setCreating(true)}
                className="flex flex-col items-start gap-1 rounded-xl border border-dashed border-slate-300 bg-white p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/40">
                <Plus className="h-5 w-5 text-emerald-600" aria-hidden />
                <span className="text-[12px] font-semibold text-slate-800">Create new sheet</span>
                <span className="text-[10.5px] text-slate-500">With its columns ready</span>
              </button>
            </div>
          )
        ) : (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50"><GoogleSheetsIcon className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-slate-800">{String(cfg.spreadsheet_name || preview?.title || "Google Sheet")}</p>
                <p className="text-[10.5px] text-slate-500">
                  {loading ? "Reading the sheet…" : preview ? `${preview.headers.length} columns · ${preview.total_rows} rows` : loadError ? "Could not open" : ""}
                </p>
              </div>
              <a href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`} target="_blank" rel="noreferrer" aria-label="Open the sheet in Google Sheets"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
              <button type="button" onClick={() => void load(spreadsheetId, tab)} aria-label="Read the sheet again"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden /></button>
            </div>
            {preview && preview.tabs.length > 0 && (
              <Select value={tab || null} onValueChange={(v) => { setTestResult(null); onChange({ ...cfg, sheet_title: String(v ?? "") }); }}>
                <SelectTrigger className="h-8 w-full text-xs" aria-label="Tab"><SelectValue placeholder="Tab…" /></SelectTrigger>
                <SelectContent>
                  {preview.tabs.filter((t) => t.title !== "Deleted" || tab === "Deleted").map((t) => <SelectItem key={t.title} value={t.title}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {loadError && <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{loadError}</p>}
            <button type="button" onClick={() => setChoosing(true)} className="text-[11px] font-medium text-indigo-600 hover:underline">Use a different sheet</button>
          </div>
        )}
      </Section>

      {spreadsheetId && (
        <>
          <Section title="What should this step do?">
            <Segmented label="Action" value={action} onChange={(v) => { setTestResult(null); onChange({ ...cfg, action: v }); }}
              options={[["add", "Add row"], ["update", "Update"], ["delete", "Delete"]] as const} />
          </Section>

          {action === "add" && (
            <Section title="If the row may already be there">
              <div className="space-y-1" role="radiogroup" aria-label="If the row may already be there">
                {([
                  ["always", "Always add a new row"],
                  ["if_missing", "Add only if not already there"],
                  ["upsert", "Update it if there, else add"],
                ] as const).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={addMode === v}
                    onClick={() => { setTestResult(null); onChange({ ...cfg, add_mode: v }); }}
                    className={cn("flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors",
                      addMode === v ? "border-indigo-400 bg-indigo-50/60 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                    <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border", addMode === v ? "border-indigo-600" : "border-slate-300")}>
                      {addMode === v && <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {needsFind && (
            <Section title={action === "add" ? "It is “already there” when" : "Find rows where"}>
              {conds.filter((c) => c.column).length > 1 && (
                <Segmented label="How conditions combine" cols={2} value={match} onChange={(v) => onChange({ ...cfg, match: v, conditions: conds })}
                  options={[["all", "All of these (AND)"], ["any", "Any of these (OR)"]] as const} />
              )}
              {conds.map((c, i) => {
                const needsValue = c.op !== "empty" && c.op !== "not_empty";
                return (
                  <div key={i} className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5">
                    {i > 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{match === "any" ? "or" : "and"}</span>}
                    <div className="flex items-center gap-1.5">
                      <Select value={c.column || null} onValueChange={(v) => {
                        const col = String(v ?? "");
                        const phoneish = /phone|mobile|whatsapp|number/i.test(col);
                        condAt(i, { column: col, op: phoneish ? "phone" : "equals", value: phoneish ? "{{contact.phone}}" : "" });
                      }}>
                        <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={`Condition ${i + 1} column`}><SelectValue placeholder="Column…" /></SelectTrigger>
                        <SelectContent>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                      </Select>
                      <button type="button" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label={`Remove condition ${i + 1}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </div>
                    <Select value={c.op} onValueChange={(v) => condAt(i, { op: String(v ?? "equals") as Op })}>
                      <SelectTrigger className="h-8 w-full text-xs" aria-label={`Condition ${i + 1} comparison`}><SelectValue /></SelectTrigger>
                      <SelectContent>{OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                    {needsValue && (
                      <ValuePicker label={`Condition ${i + 1} value`} value={c.value} options={options.filter((o) => o.value !== CLEAR_TOKEN)}
                        usedElsewhere={new Set()} onChange={(v) => condAt(i, { value: v })}
                        choices={preview ? preview.dropdowns[String(preview.headers.indexOf(c.column))] : undefined} />
                    )}
                  </div>
                );
              })}
              {conds.length < 5 && (
                <button type="button" onClick={() => setConds([...conds, { column: "", op: "equals", value: "" }])}
                  className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"><Plus className="h-3 w-3" aria-hidden /> Add condition</button>
              )}
              {conds.filter((c) => c.column).length === 0 && <p className="text-[10.5px] text-rose-700">Add a condition — a step never touches a whole sheet.</p>}
            </Section>
          )}

          {(action === "update" || action === "delete") && (
            <Section title="If more than one row matches">
              <Segmented label="Which rows" value={which} onChange={(v) => onChange({ ...cfg, which: v })}
                options={[["latest", "Latest"], ["oldest", "Oldest"], ["all", "All (≤ 20)"]] as const} />
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-600">{which === "all" ? "Date column (for “older than”)" : "“Latest” is decided by"}</span>
                <Select value={dateColumn || "__position__"} onValueChange={(v) => onChange({ ...cfg, date_column: v === "__position__" ? "" : String(v ?? "") })}>
                  <SelectTrigger className="h-8 w-full text-xs" aria-label="Date column"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__position__">Position in the sheet (lowest row is newest)</SelectItem>
                    {headers.map((h) => <SelectItem key={h} value={h}>The date in “{h}”</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </Section>
          )}

          {action === "delete" && (
            <Section title="How to delete">
              <Segmented label="How to delete" cols={2} value={deleteMode} onChange={(v) => onChange({ ...cfg, delete_mode: v })}
                options={[["archive", "Move to “Deleted” tab"], ["delete", "Delete permanently"]] as const} />
              <p className="flex items-start gap-1.5 text-[10.5px] text-slate-500">
                <Archive className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {deleteMode === "archive" ? "The row is copied to a “Deleted” tab with when and from where, then removed — copy it back to restore." : "Gone from the sheet. The run log keeps a copy of the row."}
              </p>
              <div className="flex items-center gap-2 text-[11.5px] text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={olderThan > 0}
                    onChange={(e) => onChange({ ...cfg, older_than_days: e.target.checked ? 30 : 0 })} />
                  Only rows older than
                </label>
                <Input type="number" min={1} max={3650} disabled={olderThan === 0} className="h-7 w-16 text-xs" aria-label="Days old"
                  value={olderThan || ""} onChange={(e) => onChange({ ...cfg, older_than_days: Math.max(1, Math.min(3650, Number(e.target.value) || 1)) })} />
                <span>days</span>
              </div>
              {olderThan > 0 && !dateColumn && <p className="text-[10.5px] text-rose-700">Choose the date column above.</p>}
            </Section>
          )}

          {action !== "delete" && (
            <Section title={action === "update" ? "Write into the row" : "Columns"} aside={
              <Button type="button" size="sm" variant={mapping.length ? "outline" : "default"} onClick={() => setMapOpen(true)} disabled={!preview && !loadError}>
                <Sparkles aria-hidden /> {mapping.length ? "Edit mapping" : "Map columns"}
              </Button>
            }>
              {mapping.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-center text-[11px] text-slate-500">
                  Nothing mapped yet. “Map columns” shows every column of the sheet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {mapping.slice(0, 8).map((m) => (
                    <li key={m.column} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{m.column}</span>
                      <span className="text-slate-300" aria-hidden>←</span>
                      <span className={cn("min-w-0 max-w-[55%] truncate rounded px-1.5 py-0.5", options.some((o) => o.value === m.value) ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700")}>
                        {labelOf(m.value)}
                      </span>
                    </li>
                  ))}
                  {mapping.length > 8 && <li className="px-2.5 py-1.5 text-[11px] text-slate-500">+{mapping.length - 8} more</li>}
                </ul>
              )}
              {preview && mapping.some((m) => !headers.some((h) => h.toLowerCase() === m.column.toLowerCase())) && headers.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10.5px] text-amber-900">
                  {mapping.filter((m) => !headers.some((h) => h.toLowerCase() === m.column.toLowerCase())).map((m) => `“${m.column}”`).join(", ")} is not in the sheet — renamed or removed? Edit the mapping.
                </p>
              )}
            </Section>
          )}

          {summary && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11.5px] leading-relaxed text-emerald-900">
              {summary} Next steps can use the row as {"{{vars.sheet_<column>}}"}.
            </p>
          )}

          <section className="space-y-2 rounded-xl border border-dashed border-slate-300 p-2.5">
            <h4 className="text-xs font-medium text-slate-700">Test with this sheet</h4>
            {tokens.map((t) => (
              <Input key={t} className="h-8 text-xs" value={samples[t] ?? ""} autoComplete="off" aria-label={`Sample for ${labelOf(t)}`}
                placeholder={`${labelOf(t)}${t === "{{contact.phone}}" ? " — e.g. +91 94950 43668" : ""}`}
                onChange={(e) => setSamples((s) => ({ ...s, [t]: e.target.value }))} />
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => void test()} disabled={testing || !tab}>
              {testing && <Loader2 className="animate-spin" aria-hidden />} Run test
            </Button>
            <div aria-live="polite">
              {testResult ? (
                <div className={cn("space-y-1 rounded-lg px-2.5 py-2 text-[11px]",
                  testResult.tone === "ok" ? "bg-emerald-50 text-emerald-900" : testResult.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-700")}>
                  <p className="whitespace-pre-line">{testResult.text}</p>
                  {testResult.rows?.map((r, i) => <p key={i} className="break-words font-mono text-[10.5px] opacity-80">{r}</p>)}
                </div>
              ) : (
                <p className="text-[10.5px] text-slate-500">Reads the real sheet; writes nothing.</p>
              )}
            </div>
          </section>

          {activity}

          {mapOpen && <MappingDialog open onClose={() => setMapOpen(false)} headers={headers} sample={preview?.sample ?? []}
            dropdowns={preview?.dropdowns ?? {}} mapping={mapping} options={options} forUpdate={action === "update" || addMode === "upsert"}
            onSave={(m) => { setTestResult(null); onChange({ ...cfg, mapping: m }); }} />}
        </>
      )}

      {choosing && (
        <GoogleSheetChooser
          subtitle="The chatbot adds, updates or deletes rows in it"
          returnTo={typeof window !== "undefined" ? window.location.pathname : "/chatbots"}
          onClose={() => setChoosing(false)}
          onChosen={(s) => { setChoosing(false); chooseSheet(s.id, s.name); }}
        />
      )}
    </div>
  );
}
