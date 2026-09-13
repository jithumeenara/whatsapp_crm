"use client";

/**
 * Confirm-then-send for a one-time code.
 *
 * The icon used to fire on a single click. Sending a customer a
 * verification code is not an action to take by brushing past a button —
 * it lands on their phone immediately, and there is no unsending it.
 *
 * The second half matters as much as the confirmation. The code used to
 * arrive as a ten-second toast, which is exactly the wrong place for it:
 * an agent reading a code out over a call needs it large, still on
 * screen, and copyable, not sliding out of the corner while they are
 * looking at the phone. So the dialog stays open and shows it.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2, Send, Check, Copy, ShieldCheck } from "lucide-react";

interface SendOtpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName?: string | null;
  contactPhone?: string | null;
}

export function SendOtpDialog({
  open,
  onOpenChange,
  conversationId,
  contactName,
  contactPhone,
}: SendOtpDialogProps) {
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Back to the confirm step whenever it reopens. Without this, the next
  // conversation's dialog opens already showing the previous customer's
  // code, which is both confusing and a small privacy leak.
  useEffect(() => {
    if (open) {
      setCode(null);
      setCopied(false);
      setSending(false);
    }
  }, [open]);

  const displayName = contactName?.trim() || contactPhone?.trim() || "this customer";

  const handleSend = useCallback(async () => {
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      // Parsed defensively — an error response is not guaranteed to carry
      // JSON, and letting the parse throw would replace a real status
      // with a parser complaint.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Could not send the code (${res.status})`);
        return;
      }
      setCode(String(data?.code ?? ""));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setSending(false);
    }
  }, [conversationId]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded views. Say so rather than leaving a button that looks
      // like it worked.
      toast.error("Could not copy — select the code and copy it manually.");
    }
  }, [code]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {code === null ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-500/15">
                  <KeyRound className="h-4 w-4" />
                </span>
                Send a one-time code
              </DialogTitle>
            </DialogHeader>

            <div className="rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Goes to
              </p>
              <p className="mt-1 truncate text-[14px] font-semibold text-slate-900">{displayName}</p>
              {contactPhone && contactName && (
                <p className="mt-0.5 truncate text-[12px] tabular-nums text-slate-500">{contactPhone}</p>
              )}
            </div>

            <p className="text-[12px] leading-relaxed text-slate-600">
              A fresh six-digit code is generated and sent now, as an approved Authentication template with a
              Copy&nbsp;code button. It arrives on their phone immediately and cannot be recalled.
            </p>

            <div className="mt-1 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleSend()} disabled={sending} className="gap-1.5">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending…" : "Send code"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/15">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                Code sent to {displayName}
              </DialogTitle>
            </DialogHeader>

            {/* Large, spaced and copyable: this is read aloud over a phone
                call as often as it is copied. */}
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50/80 to-[#F7F8FC] p-4 text-center ring-1 ring-emerald-500/15">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/70">
                Their code
              </p>
              <p className="mt-1.5 font-mono text-[30px] font-semibold leading-none tracking-[0.3em] tabular-nums text-slate-900">
                {code}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCopy()}
                className="mt-2.5 h-7 gap-1.5 text-[12px] text-emerald-700 hover:bg-emerald-100/60"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy code"}
              </Button>
            </div>

            <p className="text-[12px] leading-relaxed text-slate-600">
              It is in the conversation above as well, so you can find it again after closing this.
            </p>

            <div className="mt-1 flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
