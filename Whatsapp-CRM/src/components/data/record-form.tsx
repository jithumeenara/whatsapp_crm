'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2, Paperclip, X, ImageIcon, PenLine, Eraser, FilePlus2, AlertTriangle,
} from 'lucide-react';
import DOMPurify from 'isomorphic-dompurify';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DataField, DataRecord, FieldValidation, SelectOption } from '@/lib/data-store/types';
import {
  getSelectItems, getFieldConfig, DATA_FIELD_TYPES,
} from '@/lib/data-store/types';
import { COUNTRIES, getStatesForCountry } from '@/lib/data-store/geo-data';
import { cn } from '@/lib/utils';

// ─── File upload widget ───────────────────────────────────────

function FileUploadField({
  value,
  onChange,
  imageOnly = false,
}: {
  value: string;
  onChange: (url: string) => void;
  imageOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const isImage = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(value);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Upload failed');
      onChange(d.url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange('');
    if (inputRef.current) inputRef.current.value = '';
    setUploadError('');
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={imageOnly ? 'image/*' : 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx'}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <div className="flex items-center gap-2">
        <button type="button" disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 h-8 px-3 shrink-0 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
          {uploading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Paperclip className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : imageOnly ? 'Browse image' : 'Browse file'}
        </button>
        {value ? (
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className="text-[12px] text-slate-500 truncate">{value.split('/').pop()}</span>
            <button type="button" onClick={clear}
              className="shrink-0 p-0.5 rounded text-slate-400 hover:text-rose-500 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : !uploading && (
          <span className="text-[12px] text-slate-400">No file selected</span>
        )}
      </div>
      {uploadError && <p className="text-[11px] text-rose-500">{uploadError}</p>}
      {value && (isImage ? (
        <img src={value} alt="preview"
          className="h-24 w-auto rounded-lg border border-slate-200 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <a href={value} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-indigo-600 hover:underline">
          <ImageIcon className="h-3 w-3" /> View file
        </a>
      ))}
    </div>
  );
}

// ─── Signature canvas ─────────────────────────────────────────

function SignaturePad({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
    }
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = 'touches' in e ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  };

  const start = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    drawing.current = true;
    const ctx = canvas.getContext('2d')!;
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d')!;
    const { x, y } = getPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }, []);

  const stop = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  }, [onChange]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border border-slate-200 overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1.5 text-slate-500/40 text-xs">
              <PenLine className="size-3.5" />
              Sign here
            </div>
          </div>
        )}
      </div>
      <button type="button" onClick={clear}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors">
        <Eraser className="size-3.5" /> Clear signature
      </button>
    </div>
  );
}

// ─── Address block ────────────────────────────────────────────

interface AddressValue {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
}

function AddressField({
  value,
  onChange,
}: {
  value: AddressValue;
  onChange: (v: AddressValue) => void;
}) {
  const set = (key: keyof AddressValue, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-2">
      <Input placeholder="Street address" value={value.street ?? ''}
        onChange={(e) => set('street', e.target.value)} className="text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="City" value={value.city ?? ''}
          onChange={(e) => set('city', e.target.value)} className="text-sm" />
        <Input placeholder="State / Region" value={value.state ?? ''}
          onChange={(e) => set('state', e.target.value)} className="text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Postal code" value={value.postal ?? ''}
          onChange={(e) => set('postal', e.target.value)} className="text-sm" />
        <Select value={String(value.country ?? '')} onValueChange={(v) => v && set('country', v)}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent className="max-h-56">
            {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Validate a field value ───────────────────────────────────

function validateValue(
  value: unknown,
  validation: FieldValidation | undefined,
  label: string,
): string | null {
  if (!validation) return null;
  const str = String(value ?? '');
  if (validation.minLength && str.length < validation.minLength) {
    return validation.custom_message ?? `${label} must be at least ${validation.minLength} characters.`;
  }
  if (validation.maxLength && str.length > validation.maxLength) {
    return validation.custom_message ?? `${label} must be at most ${validation.maxLength} characters.`;
  }
  if (validation.min != null && Number(value) < validation.min) {
    return validation.custom_message ?? `${label} must be at least ${validation.min}.`;
  }
  if (validation.max != null && Number(value) > validation.max) {
    return validation.custom_message ?? `${label} must be at most ${validation.max}.`;
  }
  if (validation.pattern && !new RegExp(validation.pattern).test(str)) {
    return validation.custom_message ?? `${label} format is invalid.`;
  }
  return null;
}

// ─── Props ────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  tableId: string;
  fields: DataField[];
  record?: DataRecord | null;
  onSaved: (record: DataRecord) => void;
}

// ─── Main form ────────────────────────────────────────────────

export function RecordForm({ open, onClose, tableId, fields, record, onSaved }: Props) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [relationOptions, setRelationOptions] = useState<Record<string, { id: string; label: string }[]>>({});

  // Data-collecting fields only
  const dataFields = fields.filter((f) => DATA_FIELD_TYPES.has(f.field_type));

  useEffect(() => {
    if (open) {
      if (record?.data) {
        setData({ ...(record.data as Record<string, unknown>) });
      } else {
        // Apply default values
        const defaults: Record<string, unknown> = {};
        for (const f of dataFields) {
          const cfg = getFieldConfig(f.options);
          if (cfg.default_value != null && cfg.default_value !== '') {
            defaults[f.field_key] = cfg.default_value;
          }
          if (f.field_type === 'hidden' && cfg.hidden_value) {
            defaults[f.field_key] = cfg.hidden_value;
          }
        }
        setData(defaults);
      }
      setError('');
      setFieldErrors({});
    }
  }, [open, record]);

  // Load table-sourced options for choice fields
  const [tableSourceOptions, setTableSourceOptions] = useState<Record<string, SelectOption[]>>({});

  useEffect(() => {
    const sourceFields = dataFields.filter((f) => {
      const cfg = getFieldConfig(f.options);
      return cfg.source_table_id && cfg.source_field_key;
    });
    if (!sourceFields.length) return;
    Promise.all(
      sourceFields.map(async (f) => {
        const cfg = getFieldConfig(f.options);
        const res = await fetch(`/api/data-tables/${cfg.source_table_id}/records?pageSize=500`);
        const d = await res.json();
        const seen = new Set<string>();
        const opts: SelectOption[] = [];
        for (const r of (d.records ?? []) as DataRecord[]) {
          const raw = (r.data as Record<string, unknown>)[cfg.source_field_key!];
          const val = String(raw ?? '').trim();
          if (val && !seen.has(val)) { seen.add(val); opts.push({ label: val, value: val }); }
        }
        return { key: f.field_key, opts };
      }),
    ).then((results) => {
      const map: Record<string, SelectOption[]> = {};
      for (const { key, opts } of results) map[key] = opts;
      setTableSourceOptions(map);
    });
  }, [fields, open]);

  // Load relation options
  useEffect(() => {
    const relFields = dataFields.filter((f) => f.field_type === 'relation' && f.relation_table_id);
    if (!relFields.length) return;
    Promise.all(
      relFields.map(async (f) => {
        const res = await fetch(`/api/data-tables/${f.relation_table_id}/records?pageSize=200`);
        const d = await res.json();
        const opts = (d.records ?? []).map((r: DataRecord) => ({
          id: r.id,
          label: f.relation_label_field
            ? String((r.data as Record<string, unknown>)[f.relation_label_field] ?? r.id)
            : r.id,
        }));
        return { key: f.field_key, opts };
      }),
    ).then((results) => {
      const map: Record<string, { id: string; label: string }[]> = {};
      for (const { key, opts } of results) map[key] = opts;
      setRelationOptions(map);
    });
  }, [fields, open]);

  const set = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const validate = () => {
    const errors: Record<string, string> = {};
    for (const f of dataFields) {
      const cfg = getFieldConfig(f.options);
      const val = data[f.field_key];
      if (f.required && (val === undefined || val === null || val === '' || val === false)) {
        errors[f.field_key] = `"${f.label}" is required.`;
        continue;
      }
      if (val !== undefined && val !== null && val !== '') {
        const err = validateValue(val, cfg.validation, f.label);
        if (err) errors[f.field_key] = err;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    if (!validate()) { setError('Please fix the errors below.'); return; }
    setSaving(true);
    setError('');
    try {
      const url = record
        ? `/api/data-tables/${tableId}/records/${record.id}`
        : `/api/data-tables/${tableId}/records`;
      const res = await fetch(url, {
        method: record ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? 'Save failed.'); return; }
      onSaved(d.record);
      onClose();
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: DataField) => {
    const cfg = getFieldConfig(field.options);
    const value = data[field.field_key];
    const strVal = String(value ?? cfg.default_value ?? '');
    const placeholder = cfg.placeholder || `Enter ${field.label.toLowerCase()}…`;
    const err = fieldErrors[field.field_key];

    const inputCls = cn(
      'h-9 text-[13px] rounded-lg border-slate-200 focus-visible:border-indigo-400 focus-visible:ring-indigo-100',
      err && 'border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100',
    );

    // ── Display-only types ──────────────────────────────────
    if (field.field_type === 'section_header') {
      return (
        <div className="pt-2 pb-1 border-b border-slate-200">
          <h4 className="font-semibold text-[13px] text-slate-800">{field.label}</h4>
          {cfg.content && <p className="text-[11px] text-slate-400 mt-0.5">{cfg.content}</p>}
        </div>
      );
    }

    if (field.field_type === 'html_block') {
      return cfg.content ? (
        <div
          className="text-[13px] text-slate-500 rounded-lg bg-slate-50 px-3 py-2 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(cfg.content, { USE_PROFILES: { html: true } }) }}
        />
      ) : null;
    }

    if (field.field_type === 'hidden') {
      return null; // not shown
    }

    // ── Data input types ────────────────────────────────────
    return (
      <div>
        {field.field_type === 'text' && (
          <Input type="text" value={strVal} placeholder={placeholder} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'textarea' && (
          <Textarea value={strVal} placeholder={placeholder} rows={3} className={cn(
            'resize-none text-[13px] rounded-lg border-slate-200 focus-visible:border-indigo-400 focus-visible:ring-indigo-100',
            err && 'border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100',
          )}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'number' && (
          <Input type="number" value={strVal} placeholder={placeholder} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value ? Number(e.target.value) : '')} />
        )}

        {field.field_type === 'email' && (
          <Input type="email" value={strVal} placeholder={placeholder || 'name@example.com'} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'password' && (
          <Input type="password" value={strVal} placeholder={placeholder || '••••••••'} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'phone' && (
          <Input type="tel" value={strVal} placeholder={placeholder || '+1 555 000 0000'} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'url' && (
          <Input type="url" value={strVal} placeholder={placeholder || 'https://example.com'} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'date' && (
          <Input type="date" value={strVal} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'time' && (
          <Input type="time" value={strVal} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'datetime' && (
          <Input type="datetime-local" value={strVal} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'boolean' && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`f-${field.field_key}`}
              checked={!!value} onChange={(e) => set(field.field_key, e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-indigo-600" />
            <label htmlFor={`f-${field.field_key}`} className="text-[13px] text-slate-600">Yes</label>
          </div>
        )}

        {field.field_type === 'select' && (
          <Select value={strVal} onValueChange={(v) => v && set(field.field_key, v)}>
            <SelectTrigger className={inputCls}><SelectValue placeholder={placeholder || 'Select an option…'} /></SelectTrigger>
            <SelectContent>
              {(tableSourceOptions[field.field_key] ?? getSelectItems(field.options)).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field.field_type === 'multiselect' && (
          <div className="flex flex-wrap gap-2">
            {(tableSourceOptions[field.field_key] ?? getSelectItems(field.options)).map((opt) => {
              const selected = Array.isArray(value) ? (value as string[]).includes(opt.value) : false;
              return (
                <label key={opt.value} className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-all select-none',
                  selected
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-500 hover:border-indigo-300',
                )}>
                  <input type="checkbox" className="sr-only" checked={selected}
                    onChange={(e) => {
                      const curr = Array.isArray(value) ? (value as string[]) : [];
                      set(field.field_key, e.target.checked
                        ? [...curr, opt.value]
                        : curr.filter((v) => v !== opt.value));
                    }} />
                  {opt.label}
                </label>
              );
            })}
          </div>
        )}

        {field.field_type === 'radio' && (
          <div className="flex flex-col gap-2">
            {(tableSourceOptions[field.field_key] ?? getSelectItems(field.options)).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-[13px] text-slate-700">
                <input type="radio" name={`radio-${field.field_key}`} value={opt.value}
                  checked={strVal === opt.value}
                  onChange={() => set(field.field_key, opt.value)}
                  className="accent-indigo-600" />
                {opt.label}
              </label>
            ))}
          </div>
        )}

        {field.field_type === 'country' && (
          <Select value={strVal} onValueChange={(v) => v && set(field.field_key, v)}>
            <SelectTrigger className={inputCls}><SelectValue placeholder={placeholder} /></SelectTrigger>
            <SelectContent className="max-h-56">
              {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {field.field_type === 'state' && (
          <Select value={strVal} onValueChange={(v) => v && set(field.field_key, v)}>
            <SelectTrigger className={inputCls}><SelectValue placeholder={placeholder} /></SelectTrigger>
            <SelectContent className="max-h-56">
              {/* Show states for the country field if linked, else all common states */}
              {(() => {
                // Try to find a country field in this record
                const countryField = dataFields.find((f) => f.field_type === 'country');
                const selectedCountry = countryField ? String(data[countryField.field_key] ?? '') : '';
                const states = getStatesForCountry(selectedCountry);
                return states.length > 0
                  ? states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)
                  : <SelectItem value="_text" disabled>Type state name below</SelectItem>;
              })()}
            </SelectContent>
          </Select>
        )}

        {field.field_type === 'district' && (
          <Input type="text" value={strVal} placeholder={placeholder || 'Enter district…'} className={inputCls}
            onChange={(e) => set(field.field_key, e.target.value)} />
        )}

        {field.field_type === 'address' && (
          <AddressField
            value={(typeof value === 'object' && value !== null ? value : {}) as Record<string, string>}
            onChange={(v) => set(field.field_key, v)}
          />
        )}

        {field.field_type === 'relation' && (
          <Select value={strVal} onValueChange={(v) => v && set(field.field_key, v)}>
            <SelectTrigger className={inputCls}><SelectValue placeholder="Select a record…" /></SelectTrigger>
            <SelectContent>
              {(relationOptions[field.field_key] ?? []).map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field.field_type === 'file' && (
          <FileUploadField value={strVal} onChange={(url) => set(field.field_key, url)} />
        )}

        {field.field_type === 'image' && (
          <FileUploadField value={strVal} onChange={(url) => set(field.field_key, url)} imageOnly />
        )}

        {field.field_type === 'signature' && (
          <SignaturePad value={strVal} onChange={(url) => set(field.field_key, url)} />
        )}
      </div>
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => !saving && onClose()} />
      <div className="relative z-10 flex w-full max-w-lg max-h-[90vh] flex-col rounded-2xl bg-white shadow-2xl border border-slate-100">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FilePlus2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-slate-900 leading-snug">
              {record ? 'Edit Record' : 'Add Record'}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {dataFields.length} field{dataFields.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {fields.map((field) => {
            const cfg = getFieldConfig(field.options);
            const isDisplay = field.field_type === 'section_header' || field.field_type === 'html_block';
            const isHidden = field.field_type === 'hidden';
            const rendered = renderField(field);
            if (rendered === null) return null;

            return (
              <div
                key={field.field_key}
                className={cn(
                  isDisplay ? 'col-span-full' : '',
                  cfg.field_width === 'half' ? 'w-[calc(50%-0.5rem)]' : cfg.field_width === 'third' ? 'w-[calc(33%-0.5rem)]' : '',
                )}
              >
                {!isDisplay && !isHidden && (
                  <label className="mb-1.5 block text-[12.5px] font-medium text-slate-700">
                    {field.label}
                    {field.required && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                )}
                {rendered}
                {cfg.help_text && !isHidden && (
                  <p className="mt-1 text-[11px] text-slate-400">{cfg.help_text}</p>
                )}
                {fieldErrors[field.field_key] && (
                  <p className="mt-1 text-[11px] text-rose-500">{fieldErrors[field.field_key]}</p>
                )}
              </div>
            );
          })}

          {fields.filter((f) => DATA_FIELD_TYPES.has(f.field_type)).length === 0 && (
            <p className="text-[13px] text-slate-400 text-center py-4">
              No fields defined yet. Add fields in the Fields tab first.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-rose-600 leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || dataFields.length === 0}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {record ? 'Save Changes' : 'Add Record'}
          </button>
        </div>
      </div>
    </div>
  );
}
