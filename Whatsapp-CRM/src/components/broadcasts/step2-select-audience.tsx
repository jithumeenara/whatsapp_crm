'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Tag, Contact } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users, ArrowRight, ArrowLeft, X, Search, Phone,
  CheckCheck, Tag as TagIcon, FileSpreadsheet, Upload, AlertCircle, Trash2,
  ShieldCheck, Loader2, CheckCircle2, XCircle,
} from 'lucide-react';

/* ── types ─────────────────────────────────────────────────────── */
type AudienceMode = 'all' | 'tags' | 'pick' | 'excel';

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'contacts';
  tagIds?: string[];
  customField?: { fieldId: string; operator: 'is' | 'is_not' | 'contains'; value: string };
  csvContacts?: { phone: string; name?: string }[];
  contactIds?: string[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (a: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

/* ── helpers ──────────────────────────────────────────────────── */
function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

function initials(c: Contact) {
  if (c.name) return c.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return c.phone.slice(-2);
}
const GRADS = [
  'from-indigo-400 to-indigo-600', 'from-emerald-400 to-emerald-600',
  'from-violet-400 to-violet-600', 'from-sky-400 to-sky-600',
  'from-amber-400 to-amber-600', 'from-rose-400 to-rose-600',
];
function grad(id: string) {
  const s = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return GRADS[s % GRADS.length];
}

function WaBadge() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#25D366]">
      <svg viewBox="0 0 24 24" fill="white" className="h-2.5 w-2.5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </span>
  );
}

/* ── Excel parser ────────────────────────────────────────────────── */
async function parseExcelFile(file: File): Promise<{ phone: string; name?: string }[]> {
  const xlsx = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = xlsx.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  return rows
    .map((row) => {
      const keys = Object.keys(row)
      const phoneKey = keys.find((k) => /phone|mobile|number|whatsapp/i.test(k))
      const nameKey  = keys.find((k) => /name/i.test(k))
      const raw = phoneKey ? String(row[phoneKey]).trim().replace(/\s+/g, '') : ''
      const phone = raw.startsWith('+') ? raw : raw ? `+${raw}` : ''
      const name  = nameKey  ? String(row[nameKey]).trim() : undefined
      return { phone, name }
    })
    .filter((r) => r.phone.length >= 7)
}

/* ── Main component ─────────────────────────────────────────────── */
export function Step2SelectAudience({ audience, onUpdate, onNext, onBack }: Step2Props) {
  /* Derive which UI mode we're in */
  const initMode = (): AudienceMode => {
    if (audience.type === 'tags') return 'tags';
    if (audience.type === 'contacts') return 'pick';
    if (audience.type === 'csv') return 'excel';
    return 'all';
  };
  const [mode, setMode] = useState<AudienceMode>(initMode);

  /* All WhatsApp contacts (full list for the picker) */
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [totalWa, setTotalWa] = useState(0);

  /* Search / tag filter for the picker list */
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageTotal, setPageTotal] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PAGE = 20;

  /* Tags */
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(audience.tagIds ?? []);

  /* Selected contact IDs (for pick mode) */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(audience.type === 'contacts' ? (audience.contactIds ?? []) : [])
  );
  /* Full contact objects for preview */
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);

  /* Excel import */
  const [excelContacts, setExcelContacts] = useState<{ phone: string; name?: string }[]>(
    audience.type === 'csv' ? (audience.csvContacts ?? []) : []
  );
  const [excelFileName, setExcelFileName] = useState('');
  const [excelError, setExcelError]       = useState('');
  const [excelLoading, setExcelLoading]   = useState(false);
  const [isDragging, setIsDragging]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* WhatsApp validation */
  type ValidationStatus = 'idle' | 'validating' | 'done';
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle');
  const [validationMap, setValidationMap] = useState<Map<string, 'valid' | 'invalid' | 'unknown'>>(new Map());
  const [validationProgress, setValidationProgress] = useState(0);

  /* ── Fetch WhatsApp contacts (paginated) ─────────────────────── */
  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const params = new URLSearchParams({ channel: 'whatsapp', limit: String(PAGE), page: String(page) });
      if (query) params.set('search', query);
      if (mode === 'tags' && selectedTagIds.length > 0) params.set('tagIds', selectedTagIds.join(','));
      const res = await fetch(`/api/contacts?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setAllContacts(data.contacts ?? []);
      setPageTotal(data.total ?? 0);
    } finally {
      setLoadingContacts(false);
    }
  }, [page, query, mode, selectedTagIds]);

  /* Fetch total WhatsApp count once */
  useEffect(() => {
    fetch('/api/contacts?channel=whatsapp&limit=1')
      .then((r) => r.json())
      .then((d) => setTotalWa(d.total ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  /* ── Fetch tags ─────────────────────────────────────────────── */
  useEffect(() => {
    fetch('/api/tags', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []))
      .catch(() => {});
  }, []);

  /* ── Restore selected contacts for preview on remount ────────── */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || selectedIds.size === 0) return;
    hydratedRef.current = true;
    fetch('/api/contacts?channel=whatsapp&limit=100')
      .then((r) => r.json())
      .then((d) => {
        const all: Contact[] = d.contacts ?? [];
        setSelectedContacts(all.filter((c) => selectedIds.has(c.id)));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Search debounce ─────────────────────────────────────────── */
  function handleSearch(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(0); setQuery(v); }, 300);
  }

  /* ── Mode switch ─────────────────────────────────────────────── */
  function switchMode(m: AudienceMode) {
    setMode(m);
    setPage(0);
    setQuery('');
    setSearch('');
    if (m === 'all') onUpdate({ type: 'all' });
    else if (m === 'tags') onUpdate({ type: 'tags', tagIds: selectedTagIds });
    else if (m === 'excel') onUpdate({ type: 'csv', csvContacts: excelContacts });
    else onUpdate({ type: 'contacts', contactIds: [...selectedIds] });
  }

  /* ── Excel file handler ──────────────────────────────────────── */
  async function handleExcelFile(file: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setExcelError('Please upload an Excel file (.xlsx, .xls) or CSV (.csv)');
      return;
    }
    setExcelLoading(true);
    setExcelError('');
    try {
      const contacts = await parseExcelFile(file);
      if (contacts.length === 0) {
        setExcelError('No valid phone numbers found. Make sure your file has a column named "phone", "mobile", or "number".');
        return;
      }
      setExcelContacts(contacts);
      setExcelFileName(file.name);
      onUpdate({ type: 'csv', csvContacts: contacts });
    } catch {
      setExcelError('Failed to read file. Make sure it is a valid Excel or CSV file.');
    } finally {
      setExcelLoading(false);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleExcelFile(file);
  }

  function clearExcel() {
    setExcelContacts([]);
    setExcelFileName('');
    setExcelError('');
    setValidationStatus('idle');
    setValidationMap(new Map());
    setValidationProgress(0);
    onUpdate({ type: 'csv', csvContacts: [] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function validateWhatsApp() {
    if (excelContacts.length === 0) return;
    setValidationStatus('validating');
    setValidationProgress(0);
    const CHUNK = 50;
    const map = new Map<string, 'valid' | 'invalid' | 'unknown'>();
    for (let i = 0; i < excelContacts.length; i += CHUNK) {
      const batch = excelContacts.slice(i, i + CHUNK).map((c) => c.phone);
      try {
        const res = await fetch('/api/whatsapp/validate-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones: batch }),
        });
        if (res.ok) {
          const data = await res.json() as { results: { phone: string; status: 'valid' | 'invalid' | 'unknown' }[] };
          for (const r of data.results) map.set(r.phone, r.status);
        } else {
          for (const phone of batch) map.set(phone, 'unknown');
        }
      } catch {
        for (const phone of batch) map.set(phone, 'unknown');
      }
      setValidationProgress(Math.min(i + CHUNK, excelContacts.length));
    }
    setValidationMap(map);
    setValidationStatus('done');
    // Only pass valid (or unknown if API unavailable) contacts forward
    const validContacts = excelContacts.filter((c) => {
      const s = map.get(c.phone);
      return s === 'valid' || s === 'unknown';
    });
    onUpdate({ type: 'csv', csvContacts: validContacts });
  }

  /* ── Tag toggle ──────────────────────────────────────────────── */
  function toggleTag(id: string) {
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((t) => t !== id)
      : [...selectedTagIds, id];
    setSelectedTagIds(next);
    setPage(0);
    onUpdate({ type: 'tags', tagIds: next });
  }

  /* ── Contact toggle ──────────────────────────────────────────── */
  function toggleContact(c: Contact) {
    const next = new Set(selectedIds);
    if (next.has(c.id)) {
      next.delete(c.id);
      setSelectedContacts((prev) => prev.filter((p) => p.id !== c.id));
    } else {
      next.add(c.id);
      setSelectedContacts((prev) => prev.some((p) => p.id === c.id) ? prev : [...prev, c]);
    }
    setSelectedIds(next);
    onUpdate({ type: 'contacts', contactIds: [...next] });
  }

  function removeSelected(id: string) {
    const next = new Set(selectedIds);
    next.delete(id);
    setSelectedIds(next);
    setSelectedContacts((prev) => prev.filter((c) => c.id !== id));
    onUpdate({ type: 'contacts', contactIds: [...next] });
  }

  /* ── Select/deselect page ─────────────────────────────────────── */
  function selectAllPage() {
    const next = new Set(selectedIds);
    const toAdd: Contact[] = [];
    for (const c of allContacts) {
      if (!next.has(c.id)) { next.add(c.id); toAdd.push(c); }
    }
    setSelectedIds(next);
    setSelectedContacts((prev) => [...prev, ...toAdd]);
    onUpdate({ type: 'contacts', contactIds: [...next] });
  }
  function deselectAllPage() {
    const pageIds = new Set(allContacts.map((c) => c.id));
    const next = new Set([...selectedIds].filter((id) => !pageIds.has(id)));
    setSelectedIds(next);
    setSelectedContacts((prev) => prev.filter((c) => !pageIds.has(c.id)));
    onUpdate({ type: 'contacts', contactIds: [...next] });
  }

  const totalPages = Math.ceil(pageTotal / PAGE);

  const validCount = validationStatus === 'done'
    ? excelContacts.filter((c) => { const s = validationMap.get(c.phone); return s === 'valid' || s === 'unknown'; }).length
    : 0;
  const invalidCount = validationStatus === 'done'
    ? excelContacts.filter((c) => validationMap.get(c.phone) === 'invalid').length
    : 0;

  const isValid =
    mode === 'all' ||
    (mode === 'tags' && selectedTagIds.length > 0) ||
    (mode === 'pick' && selectedIds.size > 0) ||
    (mode === 'excel' && validationStatus === 'done' && validCount > 0);

  /* ── Summary label ───────────────────────────────────────────── */
  const summaryLabel =
    mode === 'all'
      ? `${totalWa.toLocaleString()} WhatsApp contacts`
      : mode === 'tags'
      ? selectedTagIds.length === 0
        ? 'Select at least one tag'
        : `Contacts with ${selectedTagIds.length} tag${selectedTagIds.length !== 1 ? 's' : ''}`
      : mode === 'excel'
      ? excelContacts.length === 0
        ? 'Upload an Excel file to continue'
        : validationStatus === 'idle'
          ? `${excelContacts.length} contacts imported — validate WhatsApp numbers to continue`
          : validationStatus === 'validating'
            ? `Validating ${excelContacts.length} numbers…`
            : `${validCount} valid WhatsApp numbers (${invalidCount} skipped)`
      : `${selectedIds.size} contact${selectedIds.size !== 1 ? 's' : ''} selected`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Select Audience</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">Only WhatsApp contacts can receive broadcasts.</p>
      </div>

      {/* ── Mode tabs ── */}
      <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
        {([
          { key: 'all',   label: 'All WhatsApp',   icon: Users },
          { key: 'tags',  label: 'By Tag',          icon: TagIcon },
          { key: 'pick',  label: 'Pick Contacts',   icon: CheckCheck },
          { key: 'excel', label: 'Import Excel',    icon: FileSpreadsheet },
        ] as { key: AudienceMode; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchMode(key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-all',
              mode === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tag picker (tags mode) ── */}
      {mode === 'tags' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-[12px] font-semibold text-slate-600 uppercase tracking-wide">Filter by tag</p>
          {tags.length === 0 ? (
            <p className="text-[13px] text-slate-400">No tags yet. Create tags in Settings.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = selectedTagIds.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                      on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    )}>
                    <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Excel import (excel mode) ── */}
      {mode === 'excel' && (
        <div className="space-y-4">
          {/* Drop zone */}
          {excelContacts.length === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              className={cn(
                'rounded-xl border-2 border-dashed p-10 text-center transition-all cursor-pointer',
                isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/30'
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcelFile(f); }}
              />
              {excelLoading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  <p className="text-[13px] text-slate-500">Reading file…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                    <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-slate-700">Drop your Excel file here</p>
                    <p className="mt-0.5 text-[12px] text-slate-400">or click to browse — .xlsx, .xls, .csv supported</p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white">
                    <Upload className="h-3.5 w-3.5" /> Choose File
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {excelError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
              <p className="text-[13px] text-rose-700">{excelError}</p>
            </div>
          )}

          {/* Format hint */}
          {excelContacts.length === 0 && !excelLoading && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-[12px] font-semibold text-slate-600 mb-2">Expected column names:</p>
              <div className="flex flex-wrap gap-2">
                {['phone', 'mobile', 'number', 'name'].map((col) => (
                  <span key={col} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{col}</span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Column names are case-insensitive. Phone numbers without + will have it added automatically.</p>
            </div>
          )}

          {/* Preview table */}
          {excelContacts.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  <span className="text-[13px] font-semibold text-slate-700">{excelFileName}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    {excelContacts.length} contacts
                  </span>
                </div>
                <button type="button" onClick={clearExcel}
                  className="flex items-center gap-1 text-[12px] text-rose-500 hover:text-rose-700 font-medium">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
              {/* Table header */}
              <div className="grid grid-cols-2 gap-4 px-4 py-2 bg-slate-50 border-b border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Phone</p>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Name</p>
              </div>
              {/* Rows (max 8 preview) */}
              <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
                {excelContacts.slice(0, 50).map((c, i) => (
                  <div key={i} className="grid grid-cols-2 gap-4 px-4 py-2.5">
                    <p className="text-[13px] font-mono text-slate-700 truncate">{c.phone}</p>
                    <p className="text-[13px] text-slate-500 truncate">{c.name || <span className="italic text-slate-300">—</span>}</p>
                  </div>
                ))}
                {excelContacts.length > 50 && (
                  <div className="px-4 py-2 bg-slate-50">
                    <p className="text-[12px] text-slate-400">+{excelContacts.length - 50} more contacts not shown</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WhatsApp validation */}
          {excelContacts.length > 0 && validationStatus === 'idle' && (
            <button type="button" onClick={validateWhatsApp}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-indigo-300 bg-indigo-50 py-3 text-[14px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors">
              <ShieldCheck className="h-4.5 w-4.5" />
              Verify WhatsApp Numbers
            </button>
          )}

          {validationStatus === 'validating' && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                <p className="text-[13px] font-semibold text-indigo-800">
                  Checking {excelContacts.length} numbers on WhatsApp…
                </p>
              </div>
              <div className="h-2 rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.round((validationProgress / excelContacts.length) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-indigo-600">{validationProgress} / {excelContacts.length} checked</p>
            </div>
          )}

          {validationStatus === 'done' && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-[15px] font-bold text-emerald-800">{validCount}</p>
                    <p className="text-[11px] text-emerald-600">On WhatsApp</p>
                  </div>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-center gap-3">
                  <XCircle className="h-5 w-5 text-rose-500 shrink-0" />
                  <div>
                    <p className="text-[15px] font-bold text-rose-700">{invalidCount}</p>
                    <p className="text-[11px] text-rose-500">Not on WhatsApp</p>
                  </div>
                </div>
              </div>
              {/* Validated list */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Phone</p>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Name</p>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</p>
                </div>
                <div className="divide-y divide-slate-50 max-h-56 overflow-y-auto">
                  {excelContacts.slice(0, 100).map((c, i) => {
                    const s = validationMap.get(c.phone) ?? 'unknown';
                    return (
                      <div key={i} className={cn(
                        'grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 items-center',
                        s === 'invalid' ? 'bg-rose-50/50' : ''
                      )}>
                        <p className="text-[13px] font-mono text-slate-700 truncate">{c.phone}</p>
                        <p className="text-[13px] text-slate-500 truncate">{c.name || '—'}</p>
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          s === 'valid' ? 'bg-emerald-100 text-emerald-700' :
                          s === 'invalid' ? 'bg-rose-100 text-rose-700' :
                          'bg-slate-100 text-slate-500'
                        )}>
                          {s === 'valid' ? <CheckCircle2 className="h-3 w-3" /> : s === 'invalid' ? <XCircle className="h-3 w-3" /> : null}
                          {s === 'valid' ? 'Valid' : s === 'invalid' ? 'Invalid' : 'Unknown'}
                        </span>
                      </div>
                    );
                  })}
                  {excelContacts.length > 100 && (
                    <div className="px-4 py-2 bg-slate-50">
                      <p className="text-[12px] text-slate-400">+{excelContacts.length - 100} more not shown</p>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => { setValidationStatus('idle'); setValidationMap(new Map()); onUpdate({ type: 'csv', csvContacts: excelContacts }); }}
                className="text-[12px] text-slate-500 hover:text-slate-700 underline underline-offset-2">
                Re-validate
              </button>
            </div>
          )}

          {/* Re-upload button if already has contacts */}
          {excelContacts.length > 0 && (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-[13px] text-indigo-600 hover:text-indigo-800 font-medium">
              <Upload className="h-3.5 w-3.5" /> Upload a different file
            </button>
          )}
        </div>
      )}

      {/* ── Contacts list (pick mode) ── */}
      {mode === 'pick' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {/* Search + bulk actions */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[13px] placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="Search name or phone…"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {search && (
                <button type="button" onClick={() => { setSearch(''); setPage(0); setQuery(''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button type="button" onClick={selectAllPage}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
              Select page
            </button>
            <button type="button" onClick={deselectAllPage}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
              Deselect
            </button>
          </div>

          {/* Contact rows */}
          <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
            {loadingContacts ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="h-4 w-4 rounded bg-slate-100 shrink-0" />
                  <div className="h-8 w-8 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-slate-100" />
                    <div className="h-2.5 w-24 rounded bg-slate-100" />
                  </div>
                </div>
              ))
            ) : allContacts.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-slate-400">
                {query ? 'No WhatsApp contacts match.' : 'No WhatsApp contacts found.'}
              </p>
            ) : (
              allContacts.map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleContact(c)}
                    className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      checked ? 'bg-indigo-50/70' : 'hover:bg-slate-50')}>
                    {/* Checkbox */}
                    <div className={cn('flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border-[1.5px] transition-all',
                      checked ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white')}>
                      {checked && (
                        <svg viewBox="0 0 10 8" className="h-2.5 w-2.5">
                          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      )}
                    </div>
                    {/* Avatar */}
                    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-[11px] font-bold', grad(c.id))}>
                      {initials(c)}
                    </div>
                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-800 truncate leading-snug">
                        {c.name || <span className="italic text-slate-400">Unnamed</span>}
                      </p>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
                        <Phone className="h-2.5 w-2.5 shrink-0" />{c.phone}
                      </p>
                    </div>
                    <WaBadge />
                  </button>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 bg-slate-50">
              <p className="text-[11px] text-slate-400">{pageTotal} WhatsApp contacts</p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-[12px] text-slate-500 disabled:opacity-30 hover:bg-white">‹</button>
                <span className="px-2 text-[11px] text-slate-500">{page + 1} / {totalPages}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-[12px] text-slate-500 disabled:opacity-30 hover:bg-white">›</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All / Tags mode: WhatsApp contacts preview ── */}
      {(mode === 'all' || mode === 'tags') && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[13px] placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="Preview contacts…"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-56 overflow-y-auto">
            {loadingContacts ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="h-8 w-8 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-slate-100" />
                    <div className="h-2.5 w-24 rounded bg-slate-100" />
                  </div>
                  {/* checked indicator */}
                  <div className="h-4 w-4 rounded bg-indigo-100 shrink-0" />
                </div>
              ))
            ) : allContacts.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-400">
                {mode === 'tags' ? 'No contacts with selected tags.' : 'No WhatsApp contacts found.'}
              </p>
            ) : (
              allContacts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50/30">
                  {/* Pre-checked (read-only visual) */}
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] border-indigo-500 bg-indigo-500">
                    <svg viewBox="0 0 10 8" className="h-2.5 w-2.5">
                      <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </div>
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-[10px] font-bold', grad(c.id))}>
                    {initials(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-800 truncate">
                      {c.name || <span className="italic text-slate-400">Unnamed</span>}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{c.phone}</p>
                  </div>
                  <WaBadge />
                </div>
              ))
            )}
          </div>
          {pageTotal > PAGE && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 bg-slate-50">
              <p className="text-[11px] text-slate-400">Showing {allContacts.length} of {pageTotal}</p>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-[12px] text-slate-500 disabled:opacity-30 hover:bg-white">‹</button>
                <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-[12px] text-slate-500 disabled:opacity-30 hover:bg-white">›</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Selected preview (pick mode) ── */}
      {mode === 'pick' && selectedContacts.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {/* Stacked avatars */}
              <div className="flex -space-x-1.5">
                {selectedContacts.slice(0, 5).map((c) => (
                  <div key={c.id}
                    className={cn('h-6 w-6 rounded-full ring-2 ring-indigo-50 flex items-center justify-center bg-gradient-to-br text-white text-[9px] font-bold shrink-0', grad(c.id))}>
                    {initials(c)}
                  </div>
                ))}
                {selectedContacts.length > 5 && (
                  <div className="h-6 w-6 rounded-full ring-2 ring-indigo-50 bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600">
                    +{selectedContacts.length - 5}
                  </div>
                )}
              </div>
              <p className="text-[13px] font-semibold text-indigo-800">
                {selectedContacts.length} contact{selectedContacts.length !== 1 ? 's' : ''} selected
              </p>
            </div>
            <button type="button" onClick={() => { setSelectedIds(new Set()); setSelectedContacts([]); onUpdate({ type: 'contacts', contactIds: [] }); }}
              className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium">
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {selectedContacts.map((c) => (
              <span key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white pl-2.5 pr-1.5 py-0.5 text-[12px] font-medium text-indigo-800">
                <span className={cn('h-3.5 w-3.5 rounded-full shrink-0 flex items-center justify-center bg-gradient-to-br text-white text-[7px] font-bold', grad(c.id))}>
                  {initials(c)[0]}
                </span>
                {c.name || c.phone}
                <button type="button" onClick={() => removeSelected(c.id)}
                  className="text-indigo-300 hover:text-indigo-600 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary bar ── */}
      <div className={cn(
        'flex items-center gap-3 rounded-xl border px-4 py-3',
        isValid ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
      )}>
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          isValid ? 'bg-emerald-100' : 'bg-slate-100')}>
          <Users className={cn('h-4 w-4', isValid ? 'text-emerald-600' : 'text-slate-400')} />
        </div>
        <div>
          <p className={cn('text-[13px] font-semibold', isValid ? 'text-emerald-800' : 'text-slate-600')}>
            {summaryLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {isValid ? 'Only WhatsApp contacts — Instagram and invalid numbers excluded.' : 'Complete your selection above.'}
          </p>
        </div>
      </div>

      {/* ── Nav ── */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} className="border-slate-200 text-slate-700 h-9">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!isValid}
          className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
