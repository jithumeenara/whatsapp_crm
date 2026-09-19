'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  X, Edit2, Trash2, Type, AlignLeft, Hash, Mail, KeyRound, Phone,
  Link2, Calendar, Clock, CalendarClock, ToggleLeft, ChevronDown, ListChecks,
  CircleDot, Globe, MapPin, Home, Link as LinkIcon, Paperclip, ImageIcon,
  PenLine, EyeOff, ExternalLink, Check, Copy,
} from 'lucide-react';
import type { DataField, DataRecord, FieldType } from '@/lib/data-store/types';
import { getSelectItems } from '@/lib/data-store/types';
import { cn } from '@/lib/utils';

/**
 * One record, read rather than edited.
 *
 * ── Why two columns ─────────────────────────────────────────────────
 *
 * A record is mostly short values — a name, a date, a phone number, a
 * designation — and one column gives each of them the full width of the
 * dialog. An eleven-field record then scrolls, which means half of it is
 * off-screen at any moment and comparing two fields involves scrolling
 * back. Paired up, the same record fits without scrolling at all.
 *
 * Long values keep the full width: a paragraph, an address, a URL, an
 * image. Those are the ones a narrow column would wrap badly, and they
 * are also the ones there are never many of.
 *
 * ── Why the values are typed rather than printed ────────────────────
 *
 * A phone number you can call, a date you can read, a choice that looks
 * like the chip it is in the form. Printing everything as grey text
 * makes a record of eleven fields into a wall, and the reason somebody
 * opened it — one number, one date — is somewhere in the middle of it.
 */

const FIELD_TYPE_ICONS: Partial<Record<FieldType, React.ComponentType<{ className?: string }>>> = {
  text: Type, textarea: AlignLeft, number: Hash, email: Mail, password: KeyRound,
  phone: Phone, url: Link2, date: Calendar, time: Clock, datetime: CalendarClock,
  boolean: ToggleLeft, select: ChevronDown, multiselect: ListChecks, radio: CircleDot,
  country: Globe, state: MapPin, district: MapPin, address: Home, relation: LinkIcon,
  file: Paperclip, image: ImageIcon, signature: PenLine, hidden: EyeOff,
};

/** Holds no record data — never shown here. */
const NON_DATA_TYPES = new Set<FieldType>(['section_header', 'html_block']);

/** Types whose value needs room to breathe, and which read badly in a
 *  half-width column. Everything else pairs up. */
const WIDE_TYPES = new Set<FieldType>(['textarea', 'address', 'url', 'image', 'signature', 'file']);

/** Types worth a copy button: things people paste elsewhere. A name or a
 *  date is read, not copied. */
const COPYABLE_TYPES = new Set<FieldType>(['phone', 'email', 'url', 'number', 'text']);

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function formatFullValue(field: DataField, value: unknown): string {
  if (isEmptyValue(value)) return '';
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No';
  if (field.field_type === 'password') return '••••••••';
  if (field.field_type === 'date') {
    const str = String(value);
    const d = /^\d{10}$/.test(str) ? new Date(parseInt(str) * 1000) : new Date(str);
    return isNaN(d.getTime())
      ? str
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (field.field_type === 'datetime') {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  if (field.field_type === 'time') return String(value);
  if (Array.isArray(value)) return (value as unknown[]).join(', ');
  return String(value);
}

function fileNameFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url.split('/').pop() ?? url);
    return decoded.length > 40 ? decoded.slice(0, 37) + '…' : decoded;
  } catch {
    return url;
  }
}

/** A stored value shown as its configured label, so a record reads the
 *  way the form that filled it did. */
function labelForChoice(field: DataField, raw: string): string {
  const match = getSelectItems(field.options).find((o) => o.value === raw);
  return match?.label ?? raw;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        // Clipboard access throws in an insecure context and in some
        // embedded browsers; failing silently is the right cost for a
        // convenience.
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          })
          .catch(() => {});
      }}
      aria-label="Copy"
      className={cn(
        'shrink-0 rounded-md p-1 opacity-0 transition-all',
        'group-hover/field:opacity-100 focus-visible:opacity-100',
        done ? 'text-emerald-500' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500',
      )}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function FieldValue({ field, value }: { field: DataField; value: unknown }) {
  if (isEmptyValue(value)) {
    // "Not set" rather than a dash. A dash is also what a value could
    // legitimately be, and somebody scanning a record should not have to
    // wonder which one this is.
    return <span className="text-[13px] italic text-slate-300">Not set</span>;
  }

  if (field.field_type === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
          value ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', value ? 'bg-emerald-500' : 'bg-slate-400')} />
        {value ? 'Yes' : 'No'}
      </span>
    );
  }

  if (field.field_type === 'multiselect' && Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {(value as unknown[]).map((v, i) => (
          <span
            key={i}
            className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[12px] text-indigo-600"
          >
            {labelForChoice(field, String(v))}
          </span>
        ))}
      </div>
    );
  }

  if (field.field_type === 'select' || field.field_type === 'radio') {
    return (
      <span className="inline-flex rounded-md bg-indigo-50 px-1.5 py-0.5 text-[12.5px] text-indigo-600">
        {labelForChoice(field, String(value))}
      </span>
    );
  }

  if (field.field_type === 'image' || field.field_type === 'signature') {
    const url = String(value);
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={field.label}
          className="h-24 w-24 rounded-xl border border-slate-200 object-cover transition-opacity hover:opacity-90"
        />
      </a>
    );
  }

  if (field.field_type === 'file') {
    const url = String(value);
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[13px] text-indigo-600 hover:underline"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        {fileNameFromUrl(url)}
      </a>
    );
  }

  if (field.field_type === 'url') {
    const str = String(value);
    return (
      <a
        href={str.startsWith('http') ? str : `https://${str}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 break-all text-[13px] text-indigo-600 hover:underline"
      >
        {str}
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }

  if (field.field_type === 'email') {
    return (
      <a href={`mailto:${value}`} className="break-all text-[13px] text-indigo-600 hover:underline">
        {String(value)}
      </a>
    );
  }

  if (field.field_type === 'phone') {
    return (
      <a href={`tel:${value}`} className="text-[13px] tabular-nums text-indigo-600 hover:underline">
        {String(value)}
      </a>
    );
  }

  return (
    <span
      className={cn(
        'whitespace-pre-wrap break-words text-[13px] text-slate-800',
        field.field_type === 'number' && 'tabular-nums',
      )}
    >
      {formatFullValue(field, value)}
    </span>
  );
}

export function RecordDetailModal({
  record,
  fields,
  onClose,
  onEdit,
  onDelete,
}: {
  record: DataRecord;
  fields: DataField[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const data = record.data as Record<string, unknown>;
  const visibleFields = fields.filter((f) => !NON_DATA_TYPES.has(f.field_type));

  // The record's own name in the title, rather than "Record Details"
  // over eleven fields one of which is the name. The first non-empty
  // text field is what the grid already leads with, so the dialog and
  // the row agree about what this record is called.
  const titleField = visibleFields.find(
    (f) => (f.field_type === 'text' || f.field_type === 'textarea') && !isEmptyValue(data[f.field_key]),
  );
  const title = titleField ? String(data[titleField.field_key]).slice(0, 60) : 'Record';

  const filled = visibleFields.filter((f) => !isEmptyValue(data[f.field_key])).length;

  return (
    // The app's own dialog, rather than a hand-rolled `fixed inset-0`.
    // What that was missing is not decoration: no enter/exit animation,
    // no focus trap, no Escape, and no portal — so it stacked wrongly
    // against anything else on the page. Tab used to walk straight out
    // of the open modal into the table behind it.
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="grid max-h-[88dvh] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-slate-100 px-6 py-4 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[16px] font-semibold leading-snug text-slate-900">
              {title}
            </DialogTitle>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-400">
              <span>
                {filled} of {visibleFields.length} filled
              </span>
              <span className="text-slate-300">·</span>
              <span>
                Updated{' '}
                {new Date(record.updated_at).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          {visibleFields.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-slate-400">No fields to show.</p>
          ) : (
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {visibleFields.map((f) => {
                const Icon = FIELD_TYPE_ICONS[f.field_type] ?? Type;
                const value = data[f.field_key];
                const copyable =
                  COPYABLE_TYPES.has(f.field_type) && !isEmptyValue(value) && f.field_type !== 'password';
                return (
                  <div
                    key={f.id}
                    className={cn(
                      'group/field flex min-w-0 flex-col gap-1 border-b border-slate-50 pb-3 last:border-0',
                      WIDE_TYPES.has(f.field_type) && 'sm:col-span-2',
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{f.label}</span>
                      {copyable && <CopyButton text={formatFullValue(f, value)} />}
                    </div>
                    <FieldValue field={f} value={value} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button
            onClick={onDelete}
            className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Close
            </button>
            <button
              onClick={onEdit}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
