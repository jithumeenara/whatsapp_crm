"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { QrCode, Loader2, Copy, Check, X } from "lucide-react"

interface QrData {
  qrDataUrl: string
  waLink: string
  phoneDisplay: string
}

interface WhatsAppQrButtonProps {
  className?: string
  /** Shown next to the icon when set — use inside a menu/list. Omit
   *  for the default bare icon-button look. */
  label?: string
  /** Fires the instant the trigger is clicked, before the popup opens
   *  — e.g. to close a parent dropdown menu this button lives inside. */
  onOpen?: () => void
}

/**
 * Icon button (optionally with a text label, for use inside a menu)
 * that opens a popup showing a click-to-WhatsApp QR code for this
 * account's configured WhatsApp number. Scanning it opens WhatsApp
 * with that number and "hi" pre-filled — the standard wa.me pattern.
 * Self-contained: fetches its own data on open.
 */
export function WhatsAppQrButton({ className, label, onOpen }: WhatsAppQrButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<QrData | null>(null)
  const [copied, setCopied] = useState(false)

  const openDialog = async () => {
    onOpen?.()
    setOpen(true)
    if (data) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/whatsapp/qr-code")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to load QR code")
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QR code")
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    if (!data) return
    navigator.clipboard
      .writeText(data.waLink)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="WhatsApp QR code"
        className={
          className ??
          "flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all"
        }
      >
        <QrCode className="h-4 w-4" />
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
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[340px] rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-slate-900">Scan to say hi 👋</h3>
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {loading && (
              <div className="flex h-[280px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              </div>
            )}

            {!loading && error && (
              <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center px-2">
                <p className="text-[13px] text-rose-600">{error}</p>
              </div>
            )}

            {!loading && !error && data && (
              <>
                <div className="flex justify-center rounded-xl border border-slate-100 bg-slate-50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL, no next/image benefit */}
                  <img src={data.qrDataUrl} alt="WhatsApp QR code" className="h-[240px] w-[240px]" />
                </div>
                <p className="mt-3 text-center text-[12.5px] text-slate-500">
                  Scanning this opens WhatsApp with{" "}
                  <span className="font-semibold text-slate-700">{data.phoneDisplay}</span>, pre-filled
                  with &ldquo;hi&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 h-9 rounded-xl border border-slate-200 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
