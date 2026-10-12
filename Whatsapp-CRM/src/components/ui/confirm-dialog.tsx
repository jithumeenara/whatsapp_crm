"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The app's confirm popup (useConfirm). Centred: the icon in a soft halo,
 * the question, what it means, and two equal buttons — the safe one on
 * the left, the action on the right in the colour of what it does.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const danger = variant === "destructive";
  const Icon = danger ? Trash2 : AlertTriangle;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden rounded-3xl border-0 bg-white p-0 sm:max-w-[400px]">
        <div className="flex flex-col items-center px-7 pb-6 pt-8 text-center">
          <span
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full ring-8",
              danger ? "bg-rose-100 text-rose-600 ring-rose-50" : "bg-amber-100 text-amber-600 ring-amber-50",
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <DialogTitle className="mt-5 text-[17px] font-semibold leading-snug text-slate-900">{title}</DialogTitle>
          {description && (
            <DialogDescription className="mt-2 text-[13.5px] leading-relaxed text-slate-500">{description}</DialogDescription>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 px-7 pb-7">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "h-11 rounded-xl text-[14px] font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              danger ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-400" : "bg-[#5B6CF9] hover:bg-[#4a5ce8] focus-visible:ring-indigo-400",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
