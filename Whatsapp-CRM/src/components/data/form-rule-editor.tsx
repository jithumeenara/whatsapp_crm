"use client"

/**
 * One question's smart behaviour, in plain words:
 *   Narrow its options by an earlier answer
 *   Fill it in from an earlier choice (and lock it)
 *   Ask it only when an earlier answer is something
 *
 * Every list offers only what can work — earlier questions, and the
 * columns of the source table the public page is allowed to carry.
 */

import { Filter, Lock, Sparkles, SplitSquareVertical } from "lucide-react"
import type { FieldRule } from "@/lib/data-store/form-logic"
import type { FormSource } from "@/lib/data-store/public-form-server"

const SELECT =
  "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

export interface EarlierQuestion {
  key: string
  label: string
  options: string[]
}

export function FormRuleEditor({
  fieldKey,
  rule,
  earlier,
  sources,
  onChange,
}: {
  fieldKey: string
  rule: FieldRule | undefined
  earlier: EarlierQuestion[]
  sources: FormSource[]
  onChange(rule: FieldRule): void
}) {
  const current: FieldRule = rule ?? { filter: null, fill: null, show_if: null }
  const ownSource = sources.find((s) => s.field_key === fieldKey)
  const earlierSources = sources.filter((s) => earlier.some((q) => q.key === s.field_key))
  const fillSource = current.fill ? sources.find((s) => s.field_key === current.fill!.from_field) : earlierSources[0]
  const showField = current.show_if ? earlier.find((q) => q.key === current.show_if!.field) : undefined

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 text-[12.5px] text-slate-700">
      {ownSource && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={!!current.filter}
              disabled={earlier.length === 0}
              onChange={(e) =>
                onChange({
                  ...current,
                  filter: e.target.checked && earlier[0]
                    ? { depends_on: earlier[0].key, match_column: ownSource.columns.find((c) => c.key !== ownSource.option_column)?.key ?? ownSource.option_column }
                    : null,
                })
              }
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <Filter className="h-3.5 w-3.5 text-slate-400" /> Narrow the options by an earlier answer
          </label>
          {current.filter && (
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 pl-6">
              <span className="text-slate-500">Show rows of {ownSource.table_name} where</span>
              <select value={current.filter.match_column} aria-label="Column to match"
                onChange={(e) => onChange({ ...current, filter: { ...current.filter!, match_column: e.target.value } })} className={SELECT}>
                {ownSource.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <span className="text-slate-500">matches the answer to</span>
              <select value={current.filter.depends_on} aria-label="Earlier question"
                onChange={(e) => onChange({ ...current, filter: { ...current.filter!, depends_on: e.target.value } })} className={SELECT}>
                {earlier.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={!!current.fill}
            disabled={earlierSources.length === 0}
            onChange={(e) =>
              onChange({
                ...current,
                fill: e.target.checked && earlierSources[0]
                  ? {
                      from_field: earlierSources[0].field_key,
                      column: earlierSources[0].columns.find((c) => c.key !== earlierSources[0].option_column)?.key ?? earlierSources[0].option_column,
                      locked: true,
                    }
                  : null,
              })
            }
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <Sparkles className="h-3.5 w-3.5 text-slate-400" /> Fill in automatically from an earlier choice
        </label>
        {earlierSources.length === 0 && (
          <p className="pl-6 text-[11.5px] text-slate-400">Needs an earlier dropdown whose options come from another table (set in Fields → Options from a table).</p>
        )}
        {current.fill && fillSource && (
          <div className="flex flex-col gap-1.5 pl-6">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
              <span className="text-slate-500">When they pick</span>
              <select value={current.fill.from_field} aria-label="Earlier choice"
                onChange={(e) => {
                  const src = sources.find((s) => s.field_key === e.target.value)
                  if (!src) return
                  onChange({ ...current, fill: { ...current.fill!, from_field: src.field_key, column: src.columns.find((c) => c.key !== src.option_column)?.key ?? src.option_column } })
                }} className={SELECT}>
                {earlierSources.map((s) => <option key={s.field_key} value={s.field_key}>{earlier.find((q) => q.key === s.field_key)?.label ?? s.field_key}</option>)}
              </select>
              <span className="text-slate-500">use its</span>
              <select value={current.fill.column} aria-label="Column to copy"
                onChange={(e) => onChange({ ...current, fill: { ...current.fill!, column: e.target.value } })} className={SELECT}>
                {fillSource.columns.map((c) => <option key={c.key} value={c.key}>{c.label} ({fillSource.table_name})</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={current.fill.locked}
                onChange={(e) => onChange({ ...current, fill: { ...current.fill!, locked: e.target.checked } })}
                className="h-4 w-4 accent-[var(--primary)]" />
              <Lock className="h-3.5 w-3.5 text-slate-400" /> Customer can&apos;t change it
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={!!current.show_if}
            disabled={earlier.length === 0}
            onChange={(e) =>
              onChange({
                ...current,
                show_if: e.target.checked && earlier[0] ? { field: earlier[0].key, equals: earlier[0].options[0] ?? "" } : null,
              })
            }
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <SplitSquareVertical className="h-3.5 w-3.5 text-slate-400" /> Ask only when an earlier answer is…
        </label>
        {current.show_if && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pl-6">
            <select value={current.show_if.field} aria-label="Earlier question"
              onChange={(e) => {
                const q = earlier.find((x) => x.key === e.target.value)
                onChange({ ...current, show_if: { field: e.target.value, equals: q?.options[0] ?? "" } })
              }} className={SELECT}>
              {earlier.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
            <span className="text-slate-500">is</span>
            {showField && showField.options.length > 0 ? (
              <select value={current.show_if.equals} aria-label="Answer"
                onChange={(e) => onChange({ ...current, show_if: { ...current.show_if!, equals: e.target.value } })} className={SELECT}>
                {showField.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={current.show_if.equals} aria-label="Answer" maxLength={200} placeholder="Yes"
                onChange={(e) => onChange({ ...current, show_if: { ...current.show_if!, equals: e.target.value } })} className={SELECT} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
