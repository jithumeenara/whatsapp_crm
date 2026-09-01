'use client';

import { Loader2, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

type Tone = 'danger' | 'success' | 'warning' | 'info';

const TONE: Record<Tone, { iconBg: string; iconColor: string; button: string }> = {
  danger: { iconBg: 'bg-rose-50', iconColor: 'text-rose-600', button: 'bg-rose-600 hover:bg-rose-700' },
  success: { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', button: 'bg-emerald-600 hover:bg-emerald-700' },
  warning: { iconBg: 'bg-amber-50', iconColor: 'text-amber-600', button: 'bg-amber-600 hover:bg-amber-700' },
  info: { iconBg: 'bg-indigo-50', iconColor: 'text-[#5B6CF9]', button: 'bg-[#5B6CF9] hover:bg-[#4a5ce8]' },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  description: ReactNode;
  actionLabel: string;
  actionPendingLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  cancelLabel?: string;
}

/**
 * A CENTERED confirm-dialog variant (icon in a circle, centered title/
 * description, full-width Cancel/Action pair) — distinct from the
 * existing `confirm-dialog.tsx` (used by `useConfirm()` and
 * `record-grid.tsx` elsewhere in the app), which is left-aligned and
 * doesn't support a `pending` state or a per-use custom icon. This one
 * exists specifically for Settings' async delete/revoke/remove actions,
 * which need both. Deliberately a SEPARATE file/name — do not merge these
 * two or repoint one at the other; the existing one has its own callers
 * that must keep working unchanged.
 */
export function ConfirmIconDialog({
  open, onOpenChange, icon: Icon, tone, title, description,
  actionLabel, actionPendingLabel, onConfirm, pending, cancelLabel = 'Cancel',
}: Props) {
  const s = TONE[tone];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 sm:max-w-sm">
        <div className="flex flex-col items-center pt-1 text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ${s.iconBg} mb-3.5`}>
            <Icon className={`h-5 w-5 ${s.iconColor}`} />
          </span>
          <DialogTitle className="text-[15px] font-semibold text-slate-900">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">
            {description}
          </DialogDescription>
        </div>
        <div className="flex gap-2 mt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="flex-1 h-9 text-[13px] border-slate-200">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={pending} className={`flex-1 h-9 text-[13px] text-white ${s.button}`}>
            {pending ? <><Loader2 className="h-4 w-4 animate-spin" />{actionPendingLabel ?? actionLabel}</> : actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
