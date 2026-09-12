'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, Maximize2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The AI section's own presentation layer.
 *
 * Every surface, control and menu in this section is built from these
 * pieces so the whole flow reads as one designed thing rather than a
 * collection of one-off class strings. Three deliberate choices run
 * through all of it:
 *
 *  - Depth comes from layered, tinted shadows and hairline rings, not
 *    from heavy borders. Hard 1px grey boxes are the look this rebuild
 *    is moving away from.
 *  - Radii step with size (controls 12px, cards 16px, overlays 24px), so
 *    nested elements never fight each other's corners.
 *  - Interactive things move: a press settles the element slightly, hover
 *    lifts it. Small, fast (120-180ms), and disabled entirely under
 *    prefers-reduced-motion via the shared motion-safe: prefix.
 *
 * These wrap base-ui primitives directly rather than the app's generic
 * ui/* components so the section can have its own identity without
 * restyling every other screen in the product.
 */

/* ─────────────────────────── Buttons ─────────────────────────── */

type ButtonTone = 'primary' | 'soft' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const TONE: Record<ButtonTone, string> = {
  // The colored glow under the primary is what makes it read as raised
  // rather than as a flat filled rectangle.
  primary:
    'bg-gradient-to-b from-[#6B7BFF] to-[#5B6CF9] text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_6px_16px_-6px_rgba(91,108,249,0.65)] hover:from-[#5F70FB] hover:to-[#4E5FEE] hover:shadow-[0_2px_4px_rgba(15,23,42,0.1),0_10px_22px_-8px_rgba(91,108,249,0.75)]',
  soft: 'bg-[#EEF0FF] text-[#4A5AE8] hover:bg-[#E4E7FF]',
  outline:
    'bg-white text-slate-700 ring-1 ring-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50 hover:ring-slate-300',
  ghost: 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-700',
  danger: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/70 hover:bg-rose-100',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-[10px] px-3 text-[12.5px]',
  md: 'h-9 gap-2 rounded-xl px-4 text-[13px]',
  lg: 'h-11 gap-2 rounded-xl px-6 text-[14px]',
  icon: 'h-9 w-9 rounded-xl',
};

export function AiButton({
  tone = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold outline-none',
        'transition-[background,box-shadow,transform,color] duration-150 ease-out',
        'motion-safe:active:translate-y-px',
        'focus-visible:ring-2 focus-visible:ring-[#5B6CF9]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'disabled:pointer-events-none disabled:opacity-55',
        TONE[tone],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

/* ─────────────────────────── Surfaces ─────────────────────────── */

export function AiCard({
  className,
  children,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white ring-1 ring-slate-200/70',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.18)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function AiCardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A tinted square that holds an icon — the section's recurring way of
 *  giving a row or card a visual anchor. */
export function AiIconTile({
  tint = 'indigo',
  size = 'md',
  children,
  className,
}: {
  tint?: 'indigo' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  className?: string;
}) {
  const tints: Record<string, string> = {
    indigo: 'bg-[#EEF0FF] text-[#5B6CF9] ring-[#5B6CF9]/10',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-500/10',
    amber: 'bg-amber-50 text-amber-600 ring-amber-500/10',
    violet: 'bg-violet-50 text-violet-600 ring-violet-500/10',
    rose: 'bg-rose-50 text-rose-600 ring-rose-500/10',
    slate: 'bg-slate-100 text-slate-500 ring-slate-400/10',
  };
  const sizes = { sm: 'h-8 w-8 rounded-[10px]', md: 'h-9 w-9 rounded-xl', lg: 'h-11 w-11 rounded-2xl' };
  return (
    <span className={cn('flex shrink-0 items-center justify-center ring-1', tints[tint], sizes[size], className)}>
      {children}
    </span>
  );
}

export function AiBadge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate';
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-[#EEF0FF] text-[#4A5AE8] ring-[#5B6CF9]/15',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-500/20',
    rose: 'bg-rose-50 text-rose-700 ring-rose-500/20',
    slate: 'bg-slate-100 text-slate-600 ring-slate-400/15',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-medium ring-1',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── Menu ─────────────────────────── */

export function AiMenu({ children, ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props}>{children}</MenuPrimitive.Root>;
}

export function AiMenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger className={className} {...props} />;
}

/**
 * Wider than the trigger by default (a menu constrained to its button's
 * width is the single most dated-looking part of the old menus), floating
 * on a soft layered shadow, with its own open/close scale animation.
 */
export function AiMenuContent({
  className,
  align = 'end',
  sideOffset = 8,
  children,
}: {
  className?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children: ReactNode;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-50 outline-none" align={align} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          className={cn(
            'w-[min(220px,calc(100vw-2rem))] min-w-[200px] origin-(--transform-origin) overflow-hidden rounded-2xl bg-white p-1.5 sm:w-auto sm:min-w-[220px]',
            'ring-1 ring-slate-200/80 shadow-[0_4px_12px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.25)]',
            'outline-none duration-150',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-top-1',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function AiMenuItem({
  icon,
  title,
  description,
  tone = 'default',
  className,
  ...props
}: Omit<MenuPrimitive.Item.Props, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-start gap-2.5 rounded-xl px-2.5 py-2 outline-none',
        'transition-colors duration-100',
        tone === 'danger'
          ? 'text-rose-600 data-highlighted:bg-rose-50'
          : 'text-slate-700 data-highlighted:bg-slate-100/90',
        className,
      )}
      {...props}
    >
      {icon && (
        <span className={cn('mt-0.5 shrink-0', tone === 'danger' ? 'text-rose-500' : 'text-slate-400')}>{icon}</span>
      )}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-tight">{title}</span>
        {description && (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{description}</span>
        )}
      </span>
    </MenuPrimitive.Item>
  );
}

export function AiMenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-slate-100" />;
}

/* ─────────────────────────── Modal ─────────────────────────── */

/**
 * A blurred, dimmed backdrop and a large-radius panel that scales in.
 * Header/body/footer are separate exports rather than props so a wizard
 * can put a stepper between the header and the body without fighting a
 * fixed layout.
 */
export function AiModal({
  open,
  onOpenChange,
  children,
  className,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const widths = { sm: 'sm:max-w-lg', md: 'sm:max-w-2xl', lg: 'sm:max-w-3xl' };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 isolate z-50 bg-slate-900/25 duration-200',
            'supports-backdrop-filter:backdrop-blur-[3px]',
            'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 sm:max-w-[calc(100%-2rem)]',
            'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-white outline-none sm:rounded-3xl',
            'ring-1 ring-slate-200/70 shadow-[0_8px_24px_rgba(15,23,42,0.08),0_32px_80px_-24px_rgba(15,23,42,0.45)]',
            'duration-200',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            widths[size],
            className,
          )}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AiModalHeader({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
      <div className="flex min-w-0 items-start gap-3 sm:gap-3.5">
        {icon}
        <div className="min-w-0">
          <h3 className="text-[16.5px] font-bold tracking-[-0.015em] text-slate-900 sm:text-[18px]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {onClose && (
        <DialogPrimitive.Close
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

export function AiModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('border-t border-slate-100 px-5 py-5 sm:px-6 sm:py-6', className)}>{children}</div>;
}

export function AiModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-5 py-3.5 sm:rounded-b-3xl sm:px-6 sm:py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────── Fields ─────────────────────────── */

const FIELD_BASE =
  'w-full rounded-xl bg-white text-slate-800 placeholder:text-slate-400 outline-none ' +
  'ring-1 ring-slate-200/90 transition-[box-shadow,background] duration-150 ' +
  'hover:ring-slate-300 focus:ring-2 focus:ring-[#5B6CF9]/45 focus:shadow-[0_0_0_4px_rgba(91,108,249,0.10)] ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function AiInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      // Browser autofill stays off across this section by default — the
      // same rule the rest of the app now follows (see ui/input.tsx).
      autoComplete="off"
      className={cn(FIELD_BASE, 'h-10 px-3.5 text-[13px]', className)}
      {...props}
    />
  );
}

export function AiTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      autoComplete="off"
      className={cn(FIELD_BASE, 'resize-none px-3.5 py-2.5 text-[13px] leading-relaxed', className)}
      {...props}
    />
  );
}

export function AiLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('block text-[12.5px] font-medium text-slate-700', className)} {...props} />;
}

export function AiHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[11px] leading-relaxed text-slate-400', className)} {...props} />;
}

/** Inline status line — used for validation, save results and errors so
 *  all three read the same way instead of three different treatments. */
export function AiNotice({
  tone,
  icon,
  children,
  className,
}: {
  tone: 'info' | 'success' | 'warning' | 'error';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'bg-slate-50 text-slate-600 ring-slate-200/70',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-500/15',
    warning: 'bg-amber-50 text-amber-800 ring-amber-500/15',
    error: 'bg-rose-50 text-rose-700 ring-rose-500/15',
  };
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] font-medium leading-relaxed ring-1',
        tones[tone],
        className,
      )}
    >
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/* ─────────────────────────── Segmented control ─────────────────────────── */

export function AiSegmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex max-w-full flex-wrap rounded-xl bg-slate-100/90 p-1', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold',
              'transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#5B6CF9]/35',
              active
                ? 'bg-white text-[#5B6CF9] shadow-[0_1px_2px_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.12)]'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Select ─────────────────────────── */

/**
 * The section's select, matching its menus and modals.
 *
 * The generic ui/select popup is the old look this rebuild is moving
 * away from: a hairline border, a flat shadow, square-ish item rows and
 * a checkmark bolted to the right edge. This one uses the same language
 * as AiMenuContent — a large radius, layered tinted shadow, rounded item
 * rows that highlight softly, and a scale-in — so opening a select and
 * opening a menu feel like the same product.
 */
export function AiSelect<T extends string>({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  children,
}: {
  value: T | null;
  onValueChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => v != null && onValueChange(v as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-white px-3.5 text-[13px] text-slate-800',
          'ring-1 ring-slate-200/90 outline-none transition-[box-shadow,background] duration-150',
          'hover:ring-slate-300',
          'focus-visible:ring-2 focus-visible:ring-[#5B6CF9]/45 focus-visible:shadow-[0_0_0_4px_rgba(91,108,249,0.10)]',
          'data-[popup-open]:ring-2 data-[popup-open]:ring-[#5B6CF9]/45',
          'data-placeholder:text-slate-400',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 truncate text-left" />
        <SelectPrimitive.Icon
          render={
            <ChevronDown className="pointer-events-none size-4 shrink-0 text-slate-400 transition-transform duration-200 data-[popup-open]:rotate-180" />
          }
        />
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={8}
          // Anchoring to the trigger rather than to the selected item
          // stops the popup jumping over the control when the current
          // value sits far down a long list.
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup
            className={cn(
              'max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto',
              'rounded-2xl bg-white p-1.5',
              'ring-1 ring-slate-200/80 shadow-[0_4px_12px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.25)]',
              'outline-none duration-150',
              'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-top-1',
              'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            )}
          >
            <SelectPrimitive.List>{children}</SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function AiSelectItem({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        'flex cursor-default select-none items-center justify-between gap-2 rounded-xl px-2.5 py-2',
        'text-[13px] text-slate-700 outline-none transition-colors duration-100',
        'data-highlighted:bg-slate-100/90',
        'data-selected:bg-[#5B6CF9]/[0.07] data-selected:font-medium data-selected:text-[#4A5AE8]',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
    >
      <SelectPrimitive.ItemText className="min-w-0 truncate">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="flex size-4 shrink-0 items-center justify-center text-[#5B6CF9]" />}
      >
        <Check className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/* ─────────────────────────── Prompt editor ─────────────────────────── */

/**
 * A textarea that can be opened full-screen.
 *
 * System prompts get long — a real one runs to hundreds of lines of
 * business rules — and editing that through a four-row window with its
 * own scrollbar is genuinely painful: you lose your place, and you can't
 * see the structure you're editing. The inline box stays for a glance
 * and a small tweak; the expand control gives the whole screen for
 * actual work.
 *
 * The dialog edits a draft copy and commits on Save, so an accidental
 * Escape can't wipe a long prompt. Cancel restores what was there.
 */
export function AiPromptEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
  title,
  subtitle,
  required = false,
  invalid = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  title: string;
  subtitle?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  function openEditor() {
    setDraft(value);
    setOpen(true);
  }

  function commit() {
    onChange(draft);
    setOpen(false);
  }

  const lineCount = value ? value.split('\n').length : 0;
  const charCount = value.length;

  return (
    <>
      <div className="relative">
        <AiTextarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={cn(
            'pr-11',
            invalid && 'ring-rose-400/70 focus:ring-rose-400/70 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.10)]',
          )}
        />
        <button
          type="button"
          onClick={openEditor}
          aria-label={`Expand ${title} to full screen`}
          title="Expand to full screen"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-slate-400 ring-1 ring-slate-200/80 backdrop-blur-sm transition-colors hover:bg-white hover:text-[#5B6CF9] hover:ring-[#5B6CF9]/35"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {charCount > 0 && (
        <p className="mt-1 text-[10.5px] tabular-nums text-slate-400">
          {lineCount.toLocaleString()} line{lineCount === 1 ? '' : 's'} · {charCount.toLocaleString()} characters
        </p>
      )}

      <AiModal open={open} onOpenChange={setOpen} size="lg">
        <div className="flex h-[85vh] flex-col">
          <AiModalHeader
            icon={
              <AiIconTile tint="indigo" size="lg">
                <Sparkles className="h-5 w-5" />
              </AiIconTile>
            }
            title={title}
            subtitle={subtitle}
            onClose={() => setOpen(false)}
          />

          <div className="min-h-0 flex-1 border-t border-slate-100 px-5 py-4 sm:px-6">
            <textarea
              autoComplete="off"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              className="h-full w-full resize-none rounded-xl bg-white px-4 py-3 font-mono text-[13px] leading-relaxed text-slate-800 ring-1 ring-slate-200/90 outline-none transition-shadow focus:ring-2 focus:ring-[#5B6CF9]/45 focus:shadow-[0_0_0_4px_rgba(91,108,249,0.10)]"
            />
          </div>

          <AiModalFooter>
            <span className="text-[11.5px] tabular-nums text-slate-400">
              {draft.split('\n').length.toLocaleString()} lines · {draft.length.toLocaleString()} characters
              {required && !draft.trim() && (
                <span className="ml-2 font-medium text-rose-600">Required — this cannot be empty.</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <AiButton tone="outline" onClick={() => setOpen(false)}>Cancel</AiButton>
              <AiButton onClick={commit} disabled={required && !draft.trim()}>
                <Check className="h-4 w-4" />
                Done
              </AiButton>
            </span>
          </AiModalFooter>
        </div>
      </AiModal>
    </>
  );
}
