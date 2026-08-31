"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { MessageSquarePlus, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { TemplatePicker, type TemplateSendValues } from "@/components/inbox/template-picker"
import type { MessageTemplate } from "@/types"

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
  const [phone, setPhone] = useState(initialPhone ?? "")
  const [name, setName] = useState(initialName ?? "")
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)

  const reset = () => {
    setPhone(initialPhone ?? "")
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
    setPhone(initialPhone ?? "")
    setName(initialName ?? "")
    setOpen(true)
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

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Phone number
            </label>
            <input
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 919876543210 (with country code)"
              className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[13.5px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 mb-3"
            />

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Name (optional)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact's name"
              className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[13.5px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 mb-3"
            />

            {error && <p className="text-[12.5px] text-rose-600 mb-3">{error}</p>}

            <button
              type="button"
              disabled={!phone.trim() || checking}
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
