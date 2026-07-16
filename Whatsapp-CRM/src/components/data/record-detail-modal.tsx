'use client';

import {
  X, Edit2, Trash2, UserRound, Type, AlignLeft, Hash, Mail, KeyRound, Phone,
  Link2, Calendar, Clock, CalendarClock, ToggleLeft, ChevronDown, ListChecks,
  CircleDot, Globe, MapPin, Home, Link as LinkIcon, Paperclip, ImageIcon,
  PenLine, EyeOff, ExternalLink,
} from 'lucide-react';
import type { DataField, DataRecord, FieldType } from '@/lib/data-store/types';
import { cn } from '@/lib/utils';

const FIELD_TYPE_ICONS: Partial<Record<FieldType, React.ComponentType<{ className?: string }>>> = {
  text: Type, textarea: AlignLeft, number: Hash, email: Mail, password: KeyRound,
  phone: Phone, url: Link2, date: Calendar, time: Clock, datetime: CalendarClock,
  boolean: ToggleLeft, select: ChevronDown, multiselect: ListChecks, radio: CircleDot,
  country: Globe, state: MapPin, district: MapPin, address: Home, relation: LinkIcon,
  file: Paperclip, image: ImageIcon, signature: PenLine, hidden: EyeOff,
};

// Field types that hold no real record data — never shown in the profile view.
const NON_DATA_TYPES = new Set<FieldType>(['section_header', 'html_block']);

function formatFullValue(field: DataField, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (field.field_type === 'password') return '••••••••'
  if (field.field_type === 'date') {
    const str = String(value)
    const d = /^\d{10}$/.test(str) ? new Date(parseInt(str) * 1000) : new Date(str)
    return isNaN(d.getTime()) ? str : d.toLocaleDateString()
  }
  if (field.field_type === 'datetime') {
    const d = new Date(String(value))
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString()
  }
  if (field.field_type === 'time') return String(value)
  if (Array.isArray(value)) return (value as unknown[]).join(', ')
  return String(value)
}

function fileNameFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url.split('/').pop() ?? url)
    return decoded.length > 40 ? decoded.slice(0, 37) + '…' : decoded
  } catch {
    return url
  }
}

function FieldValue({ field, value }: { field: DataField; value: unknown }) {
  const isEmpty = value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0)

  if (isEmpty) {
    return <span className="text-[13px] text-slate-300">—</span>
  }

  if (field.field_type === 'boolean') {
    return (
      <span className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        value ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
      )}>
        {value ? 'Yes' : 'No'}
      </span>
    )
  }

  if (field.field_type === 'image' || field.field_type === 'signature') {
    const url = String(value)
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block">
        <img
          src={url}
          alt={field.label}
          className="h-24 w-24 rounded-lg object-cover border border-slate-200 hover:opacity-90 transition-opacity"
        />
      </a>
    )
  }

  if (field.field_type === 'file') {
    const url = String(value)
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[13px] text-indigo-600 hover:text-indigo-700 hover:underline"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        {fileNameFromUrl(url)}
      </a>
    )
  }

  if (field.field_type === 'url') {
    const str = String(value)
    return (
      <a
        href={str.startsWith('http') ? str : `https://${str}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[13px] text-indigo-600 hover:text-indigo-700 hover:underline break-all"
      >
        {str}
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    )
  }

  if (field.field_type === 'email') {
    return (
      <a href={`mailto:${value}`} className="text-[13px] font-mono text-indigo-600 hover:underline break-all">
        {String(value)}
      </a>
    )
  }

  if (field.field_type === 'phone') {
    return (
      <a href={`tel:${value}`} className="text-[13px] font-mono text-indigo-600 hover:underline">
        {String(value)}
      </a>
    )
  }

  return (
    <span className={cn(
      'text-[13px] text-slate-800 whitespace-pre-wrap break-words',
      field.field_type === 'number' && 'font-mono tabular-nums',
    )}>
      {formatFullValue(field, value)}
    </span>
  )
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
  const data = record.data as Record<string, unknown>
  const visibleFields = fields.filter((f) => !NON_DATA_TYPES.has(f.field_type))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg max-h-[90vh] flex-col rounded-2xl bg-white shadow-2xl border border-slate-100">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <UserRound className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-slate-900 leading-snug">Record Details</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {visibleFields.length} field{visibleFields.length !== 1 ? 's' : ''} · Updated{' '}
              {new Date(record.updated_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {visibleFields.length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-6">No fields to show.</p>
          ) : (
            visibleFields.map((f) => {
              const Icon = FIELD_TYPE_ICONS[f.field_type] ?? Type
              return (
                <div key={f.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                    <Icon className="h-3 w-3" />
                    {f.label}
                  </div>
                  <FieldValue field={f} value={data[f.field_key]} />
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
