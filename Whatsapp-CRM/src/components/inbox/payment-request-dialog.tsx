"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IndianRupee, Loader2, Send } from "lucide-react";

interface PaymentRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

/** The Inbox's payment request. With PhonePe connected it sends a payment
 *  link (no Meta approval involved); with Razorpay, Meta's in-chat
 *  order_details, which waits on Meta's approval. Errors say which. */
export function PaymentRequestDialog({ open, onOpenChange, conversationId }: PaymentRequestDialogProps) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const parsed = Number(amount);
    if (!parsed || parsed <= 0) { toast.error("Enter a valid amount."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send-payment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, amount: parsed, description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to send payment request."); return; }
      toast.success("Payment request sent.");
      setAmount(""); setDescription("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send payment request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-amber-600" />
            Request Payment
          </DialogTitle>
        </DialogHeader>
        <p className="text-[11.5px] text-slate-400">
          Uses the gateway connected in Settings &gt; Payments. PhonePe sends a secure payment link and works within
          24 hours of the customer&apos;s last message; Razorpay&apos;s in-chat payment also needs Meta&apos;s approval
          for this number.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 text-[12px] text-slate-600">Amount (₹)</Label>
            <Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" className="h-9 text-sm" />
          </div>
          <div>
            <Label className="mb-1 text-[12px] text-slate-600">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Consultation fee" className="h-9 text-sm" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={handleSend} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
