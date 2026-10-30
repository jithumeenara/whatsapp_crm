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
import { sourceLabel } from '@/lib/data-store/sources';
import { cn, safeHref } from '@/lib/utils';
import { initials, pickTitleField, prettyValue } from '@/lib/data-store/table-view';

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
  // "october" reads "October", as in the table; the data is not changed.
  return prettyValue(String(value));
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
          value ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
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
    // Values come from forms and imports: only a web, app or inline-image address is linked.
    const url = safeHref(String(value), { dataImage: true });
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
    const url = safeHref(String(value));
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[13px] text-indigo-600 hover:underline"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        {fileNameFromUrl(String(value))}
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

  // The record's own name in the title, the same field the grid leads with.
  const titleField = pickTitleField(visibleFields, [record]);
  const title = titleField && !isEmptyValue(data[titleField.field_key]) ? String(data[titleField.field_key]).slice(0, 60) : 'Record';
  // Every other field below, in full — nothing pulled up into the header.
  const rest = visibleFields.filter((f) => f.field_key !== titleField?.field_key);
  const filled = visibleFields.filter((f) => !isEmptyValue(data[f.field_key])).length;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    // The app's own dialog (focus trap, Escape, portal), shaped as a panel
    // from the right so the table stays in view beside it on a wide screen.
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="top-0 right-0 left-auto grid h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none bg-white p-0 text-slate-800 data-open:slide-in-from-right-8 data-open:zoom-in-100 data-closed:slide-out-to-right-8 data-closed:zoom-out-100 sm:max-w-[440px] sm:rounded-l-2xl"
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-slate-100 px-5 py-4 text-left">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden>
            <ListChecks className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold text-slate-900">Record details</DialogTitle>
            <p className="text-[11.5px] text-slate-500">{filled} of {visibleFields.length} fields filled</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Who this is */}
          <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 ring-1 ring-primary/15">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[15px] font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200" aria-hidden>
                {initials(title)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[16px] font-semibold leading-snug text-slate-900">{title}</p>
                {record.source && <p className="text-[12px] text-slate-500">Added via {sourceLabel(record.source)}</p>}
              </div>
            </div>
          </div>

          {rest.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-slate-400">No other fields.</p>
          ) : (
            // One column: every value in full, never squeezed into half the panel.
            <div className="grid gap-2">
              {rest.map((f) => {
                const Icon = FIELD_TYPE_ICONS[f.field_type] ?? Type;
                const value = data[f.field_key];
                const copyable =
                  COPYABLE_TYPES.has(f.field_type) && !isEmptyValue(value) && f.field_type !== 'password';
                return (
                  <div
                    key={f.id}
                    className="group/field flex min-w-0 items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500" aria-hidden>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1 text-[11px] leading-snug text-slate-500">
                        <span className="min-w-0 break-words">{f.label}</span>
                        {copyable && <CopyButton text={formatFullValue(f, value)} />}
                      </div>
                      <div className="mt-0.5 min-w-0">
                        <FieldValue field={f} value={value} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* When and where it came from */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[12px] font-medium text-slate-700">Created &amp; updated</p>
            <div className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div>
                <p className="text-[11px] text-slate-500">Created</p>
                <p className="tabular-nums text-slate-800">{when(record.created_at)}</p>
                {record.source && <p className="text-[11px] text-slate-500">via {sourceLabel(record.source)}</p>}
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Updated</p>
                <p className="tabular-nums text-slate-800">{record.updated_at !== record.created_at ? when(record.updated_at) : '—'}</p>
              </div>
            </div>
            {record.contact && (
              <p className="text-[12px] text-slate-600">
                Customer: <span className="font-medium text-slate-800">{record.contact.name || 'Customer'}</span>{' '}
                <span className="tabular-nums text-slate-500">{record.contact.phone}</span>
              </p>
            )}
            <div className="group/field flex items-center gap-1 text-[11px] text-slate-500">
              Record ID <code translate="no" className="rounded bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600 ring-1 ring-slate-200">{record.id.slice(0, 8)}</code>
              <CopyButton text={record.id} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3.5">
          <button
            onClick={onDelete}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[13px] font-medium text-rose-700 transition-colors hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Edit2 className="h-3.5 w-3.5" aria-hidden />
            Edit
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
