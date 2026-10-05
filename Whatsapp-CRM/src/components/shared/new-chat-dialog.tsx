"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MessageSquarePlus, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { TemplatePicker, type TemplateSendValues } from "@/components/inbox/template-picker"
import { CountryCodeSelect } from "@/components/shared/country-code-select"
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, splitE164 } from "@/lib/country-codes"
import type { MessageTemplate } from "@/types"

/** The account's starting country — its admin's — fetched once per page
 *  load, not on every open. A failed fetch is forgotten, so the next
 *  open tries again; meanwhile India. */
let defaultCountry: Promise<string> | null = null
function loadDefaultCountry(): Promise<string> {
  if (!defaultCountry) {
    defaultCountry = fetch("/api/conversations/new-chat", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const iso = typeof d?.default_country_iso === "string" ? d.default_country_iso : ""
        return COUNTRY_CODES.some((c) => c.iso === iso) ? iso : DEFAULT_COUNTRY_ISO
      })
      .catch(() => {
        defaultCountry = null
        return DEFAULT_COUNTRY_ISO
      })
  }
  return defaultCountry
}

/** "+91 98765 43210" or "0091 98765…" typed or pasted into the number
 *  box: a whole international number, so its country is taken from it. */
function splitInternational(raw: string): { iso: string; local: string } | null {
  const t = raw.trim()
  const rest = t.startsWith("+") ? t.slice(1) : t.startsWith("00") ? t.slice(2) : null
  if (rest === null) return null
  const digits = rest.replace(/\D/g, "")
  return digits ? splitE164(`+${digits}`) : null
}

/** A number handed in from elsewhere (the Lead page) is stored with its
 *  country code. Ten digits or fewer has none, and is a local number. */
function splitInitial(phone: string | undefined): { iso: string; local: string } | null {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (digits.length <= 10) return null
  return splitE164(`+${digits}`)
}

interface NewChatDialogProps {
  /** Called once the first template message has actually been sent —
   *  gives the caller the new conversation_id (e.g. to select it in
   *  the inbox). A success toast fires either way, this is optional. */
  onSent?: (conversationId: string) => void
  className?: string
  /** Pre-fill the number/name — e.g. from the Lead page, where the
   *  contact being viewed is already known, so re-typing a number
   *  that's already on screen would be redundant. Still editable;
   *  this only sets the starting value. Leave unset for a blank,
   *  any-number entry point (e.g. the Inbox's generic "New chat"). */
  initialPhone?: string
  initialName?: string
  /** Shown next to the icon when set — use inside a menu/list. Omit
   *  for the default bare icon-button look. */
  label?: string
  /** Fires the instant the trigger is clicked, before the popup opens
   *  — e.g. to close a parent dropdown menu this button lives inside. */
  onOpen?: () => void
}

/**
 * "New chat" entry point: enter a phone number that hasn't messaged
 * before, resolve/create its Contact + Conversation, then pick an
 * approved template to send as the opener (WhatsApp requires a
 * template as the first outbound message to a number with no open
 * 24h session — there's no separate "is this number on WhatsApp"
 * check in the Cloud API, the send itself is the real verification).
 */
export function NewChatDialog({ onSent, className, initialPhone, initialName, label, onOpen }: NewChatDialogProps) {
  const [open, setOpen] = useState(false)
  const [iso, setIso] = useState(DEFAULT_COUNTRY_ISO)
  const [local, setLocal] = useState("")
  const [name, setName] = useState(initialName ?? "")
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  /** Set once the person picks a country, so a default arriving late
   *  never overrides their choice. */
  const countryChosen = useRef(false)

  /** The number as WhatsApp wants it: the country's code, then the
   *  number without the leading 0 people dial at home. A whole
   *  "+…" number typed into the box is taken as it is. */
  const localDigits = local.replace(/\D/g, "").replace(/^0+/, "")
  const typedInternational = /^\s*(\+|00)/.test(local)
  const dial = COUNTRY_CODES.find((c) => c.iso === iso)?.dial ?? "+91"
  const phone = typedInternational ? `+${local.trim().replace(/^00/, "").replace(/\D/g, "")}` : `${dial}${localDigits}`
  const ready = (typedInternational ? phone.length - 1 : localDigits.length) >= 6

  const startFrom = (initial: string | undefined) => {
    countryChosen.current = false
    const split = splitInitial(initial)
    if (split) {
      countryChosen.current = true
      setIso(split.iso)
      setLocal(split.local)
      return
    }
    setLocal((initial ?? "").replace(/\D/g, ""))
    setIso(DEFAULT_COUNTRY_ISO)
    void loadDefaultCountry().then((def) => {
      if (!countryChosen.current) setIso(def)
    })
  }

  const reset = () => {
    startFrom(initialPhone)
    setName(initialName ?? "")
    setError(null)
    setChecking(false)
    setConversationId(null)
    setTemplateOpen(false)
  }

  const openDialog = () => {
    onOpen?.()
    // Re-sync to the latest initial values every time it's opened —
    // covers navigating to a different lead while this stays mounted.
    startFrom(initialPhone)
    setName(initialName ?? "")
    setOpen(true)
  }

  const chooseCountry = (next: string) => {
    countryChosen.current = true
    setIso(next)
  }

  const typeNumber = (value: string) => {
    // A pasted "+91 98765 43210" fills both boxes.
    const split = splitInternational(value)
    if (split && split.local.replace(/\D/g, "").length >= 6) {
      chooseCountry(split.iso)
      setLocal(split.local)
      return
    }
    setLocal(value)
  }

  const closeAll = () => {
    setOpen(false)
    reset()
  }

  const handleContinue = async () => {
    setError(null)
    setChecking(true)
    try {
      const res = await fetch("/api/conversations/new-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error || "Could not start a chat with this number")
        return
      }
      setConversationId(body.conversation_id)
      setOpen(false)
      setTemplateOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setChecking(false)
    }
  }

  const handleSendTemplate = async (template: MessageTemplate, values: TemplateSendValues) => {
    if (!conversationId) return
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: "template",
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            bodyByName: values.bodyByName,
            headerText: values.headerText,
            headerMediaUrl: values.headerMediaUrl,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          body?.error || "This number couldn't be reached on WhatsApp — the template failed to send.",
        )
        return
      }
      toast.success("Message sent — new chat started.")
      onSent?.(conversationId)
      setTemplateOpen(false)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send template")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="New chat"
        className={
          className ??
          "flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all"
        }
      >
        <MessageSquarePlus className="h-4 w-4" />
        {label && <span>{label}</span>}
      </button>

      {open && createPortal(
        <div
          // Rendered via portal straight into <body> — this trigger button
          // can live inside a dropdown menu (which may be CSS-hidden or
          // toggling state the instant this opens); a portal makes the
          // popup a completely separate DOM subtree, immune to the
          // dropdown's own visibility/pointer-events/outside-click logic
          // no matter how those interact with this click.
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeAll}
        >
          <div
            className="w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[15px] font-bold text-slate-900">Start a new chat</h3>
              <button
                onClick={closeAll}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <p className="text-[12.5px] text-slate-500 mb-4">
              Enter a number that hasn&apos;t messaged you before. WhatsApp requires an approved
              template as the first message to a new number — you&apos;ll pick one next.
            </p>

            <label
              htmlFor="new-chat-number"
              className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1"
            >
              WhatsApp number
            </label>
            <div className="mb-3 flex gap-2">
              <CountryCodeSelect
                id="new-chat-country"
                variant="field"
                value={iso}
                onChange={chooseCountry}
                className="w-[112px] shrink-0"
              />
              <input
                id="new-chat-number"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                autoFocus
                value={local}
                onChange={(e) => typeNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && !checking) void handleContinue()
                }}
                placeholder="98765 43210"
                className="min-w-0 flex-1 h-10 rounded-xl border border-slate-200 px-3 text-[13.5px] tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            {typedInternational && (
              <p className="-mt-2 mb-3 text-[11.5px] text-slate-500">
                Using the number as typed, with its own country code.
              </p>
            )}

            <label
              htmlFor="new-chat-name"
              className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1"
            >
              Name (optional)
            </label>
            <input autoComplete="off"
              id="new-chat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact's name"
              className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[13.5px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 mb-3"
            />

            {error && <p className="text-[12.5px] text-rose-600 mb-3">{error}</p>}

            <button
              type="button"
              disabled={!ready || checking}
              onClick={handleContinue}
              className="flex w-full items-center justify-center gap-1.5 h-10 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue — choose a template
            </button>
          </div>
        </div>,
        document.body,
      )}

      <TemplatePicker
        open={templateOpen}
        onOpenChange={(v) => {
          setTemplateOpen(v)
          if (!v) reset()
        }}
        onSelect={handleSendTemplate}
        conversationId={conversationId ?? undefined}
      />
    </>
  )
}
