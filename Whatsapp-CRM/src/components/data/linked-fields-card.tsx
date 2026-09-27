"use client"

/**
 * Linked fields, set up in one click.
 *
 * A dropdown whose options come from another table (Training Programe ←
 * Training) can narrow by an earlier answer (month) and fill the fields
 * named like that table's columns (Target Group, From Date, To Date).
 * "Link automatically" reads the names and does it; each link is then
 * listed in plain words and can be removed. The links work in Add
 * Record here and in the public form alike.
 */

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Link2, Loader2, Sparkles, X } from "lucide-react"
import { describeRule, suggestRules, type FieldRule, type FormRules, type FormSource } from "@/lib/data-store/form-logic"
import type { TableFormConfig } from "@/lib/data-store/public-form"
import type { DataField } from "@/lib/data-store/types"

export function LinkedFieldsCard({
  tableId,
  fields,
  onRulesChange,
}: {
  tableId: string
  fields: DataField[]
  onRulesChange(config: TableFormConfig): void
}) {
  const [config, setConfig] = useState<TableFormConfig | null>(null)
  const [sources, setSources] = useState<FormSource[]>([])
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/data-tables/${tableId}/form`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return
        // Only admins manage links; everybody else simply uses them.
        if (!res.ok) { setHidden(true); return }
        const data = (await res.json()) as { config?: TableFormConfig; sources?: FormSource[] }
        if (data.config) setConfig(data.config)
        setSources(data.sources ?? [])
      })
      .catch(() => !cancelled && setHidden(true))
    return () => { cancelled = true }
    // Re-read when fields change: a dropdown may just have been pointed
    // at another table.
  }, [tableId, fields])

  if (hidden || !config) return null

  const label = (key: string) => fields.find((f) => f.field_key === key)?.label ?? key
  const columnLabel = (sourceField: string, column: string) =>
    sources.find((s) => s.field_key === sourceField)?.columns.find((c) => c.key === column)?.label ?? column
  const order = config.field_keys.length ? config.field_keys : fields.map((f) => f.field_key)
  const questions = order
    .map((k) => fields.find((f) => f.field_key === k))
    .filter((f): f is DataField => !!f && f.field_type !== "section_header" && f.field_type !== "html_block")
    .map((f) => ({ key: f.field_key, label: f.label }))

  async function save(rules: FormRules, message: string) {
    if (!config) return
    setBusy(true)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/form`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...config, rules } }),
      })
      const data = (await res.json().catch(() => ({}))) as { config?: TableFormConfig; error?: string }
      if (!res.ok || !data.config) throw new Error(data.error || "Could not save")
      setConfig(data.config)
      onRulesChange(data.config)
      toast.success(message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  function linkAutomatically() {
    if (!config) return
    const { rules, added } = suggestRules(questions, sources, config.rules)
    if (added.length === 0) {
      toast.message(
        sources.length === 0
          ? "First make a dropdown take its options from another table (edit the field → Options from a table)."
          : "Nothing more to link — no other field is named like a column of the linked table.",
      )
      return
    }
    void save(rules, `Linked ${added.length} field${added.length === 1 ? "" : "s"}`)
  }

  function remove(key: string, part: keyof FieldRule) {
    if (!config) return
    const next = { ...config.rules }
    const rule = { ...next[key], [part]: null } as FieldRule
    if (rule.filter || rule.fill || rule.show_if) next[key] = rule
    else delete next[key]
    void save(next, "Link removed")
  }

  const lines: Array<{ key: string; part: keyof FieldRule; text: string }> = []
  for (const [key, rule] of Object.entries(config.rules)) {
    const texts = describeRule(key, rule, label, columnLabel)
    const parts: Array<keyof FieldRule> = (["filter", "fill", "show_if"] as const).filter((p) => rule[p])
    parts.forEach((part, i) => lines.push({ key, part, text: texts[i] }))
  }

  return (
    <section className="mb-4 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Link2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold text-slate-800">Linked fields</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            Choose a month and only its programmes show; choose a programme and its group and dates fill in — in
            Add Record and the public form.
          </p>
        </div>
      </div>

      {lines.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {lines.map((l) => (
            <li key={`${l.key}-${l.part}`} className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-[12.5px] text-slate-700 ring-1 ring-slate-200">
              <span className="min-w-0 flex-1">{l.text}</span>
              <button type="button" onClick={() => remove(l.key, l.part)} disabled={busy} aria-label="Remove this link"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={linkAutomatically}
        disabled={busy}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Link fields automatically
      </button>
      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
        Works from names: a field called “From Date” is filled from a column called “Date from”. Order matters — the
        field you choose first must be above. Fine-tune each field in Share form → Questions.
      </p>
    </section>
  )
}
