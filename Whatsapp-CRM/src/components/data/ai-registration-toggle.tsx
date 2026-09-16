"use client"

/**
 * Opening a table to the assistant.
 *
 * The one switch that lets a language model create rows. It sits at the
 * top of the field panel rather than in a settings menu somewhere,
 * because the decision it asks for only makes sense next to the fields it
 * applies to: what the assistant asks for is exactly what is ticked
 * "Required" below, and the two have to be read together.
 *
 * Off for every table that already exists. Nobody should discover they
 * had switched this on.
 */

import { useState } from "react"
import { toast } from "sonner"
import { Bot, Loader2 } from "lucide-react"
import { isAiFillable, type DataField, type DataTable } from "@/lib/data-store/types"

interface Props {
  tableId: string
  table: DataTable
  fields: DataField[]
  /** Lifted so the panel survives being closed and reopened — the page
   *  holds the table row, not this component. */
  onChange: (patch: Partial<DataTable>) => void
}

export function AiRegistrationToggle({ tableId, table, fields, onChange }: Props) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(table.ai_success_message ?? "")

  const enabled = table.ai_can_register

  // Counted with the same rule the assistant itself uses, so the numbers
  // here are a promise the chat actually keeps. A table of nothing but
  // file uploads and relations reads as 0 and 0, which is the honest
  // answer.
  const fillable = fields.filter(isAiFillable)
  const requiredCount = fillable.filter((f) => f.required).length
  const optionalCount = fillable.length - requiredCount

  async function save(patch: Partial<DataTable>) {
    const before = { ai_can_register: table.ai_can_register, ai_success_message: table.ai_success_message }
    onChange(patch)
    setSaving(true)
    try {
      const res = await fetch(`/api/data-tables/${tableId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not save")
    } catch (err) {
      // Put it back. A switch showing a state the server refused is worse
      // than no switch: this one decides whether a model can write.
      onChange(before)
      setMessage(before.ai_success_message ?? "")
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
          checked={enabled}
          onChange={(e) => void save({ ai_can_register: e.target.checked })}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <Bot className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
            Let the assistant register people into this table
            {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
          </span>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-slate-500">
            On WhatsApp it asks for the{" "}
            <strong className="font-semibold text-slate-700">{requiredCount} required</strong>{" "}
            field{requiredCount === 1 ? "" : "s"}, saves the registration, and only then offers
            the <strong className="font-semibold text-slate-700">{optionalCount} optional</strong>{" "}
            one{optionalCount === 1 ? "" : "s"} — so somebody who stops replying halfway is still
            registered.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
          <label htmlFor="ai-success-message" className="block text-[11.5px] font-medium text-slate-600">
            What to say once it is saved
          </label>
          <input
            id="ai-success-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => {
              const next = message.trim()
              if (next !== (table.ai_success_message ?? "")) void save({ ai_success_message: next })
            }}
            placeholder="You're registered. We'll send the joining details closer to the date."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] outline-none transition-colors focus:border-indigo-400"
          />
          <p className="text-[10.5px] leading-relaxed text-slate-400">
            Left blank, it just confirms the registration. Worth filling in when there is a next
            step — a payment to make, a document to bring, a date to expect.
          </p>
        </div>
      )}

      {enabled && requiredCount === 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
          {fillable.length === 0
            ? "None of these fields can be filled over chat — the assistant can only ask for text, numbers, dates, email, phone, web addresses and dropdowns."
            : "No field here is marked Required, so a registration would be saved without asking anything. Tick Required on what somebody must actually give."}
        </p>
      )}
    </div>
  )
}
