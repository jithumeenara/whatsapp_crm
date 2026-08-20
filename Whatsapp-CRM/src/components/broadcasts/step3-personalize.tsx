'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Contact, CustomField, MessageTemplate } from '@/types';
import type { VariableMapping } from '@/lib/broadcasts/resolve-variables';
import type { DataTable, DataField, DataRecord as DataStoreRecord } from '@/lib/data-store/types';
import { extractVariableKeys } from '@/lib/whatsapp/template-variable-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, ArrowRight, Eye, Loader2, Database, AlertTriangle, CheckCircle2, Pencil, Sparkles,
  Reply, ExternalLink, Phone, Copy, Zap, FileText, Play, Image as ImageIcon, Film,
  File as FileIcon, Upload, X, ChevronRight, ChevronDown, PenLine, User, Tags,
} from 'lucide-react';
import { toast } from 'sonner';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

const MEDIA_ACCEPT: Record<string, string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MEDIA_ICON: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Film, document: FileIcon };

type VariableType = VariableMapping['type'];

const MAPPING_TYPE_TILES: { type: VariableType; label: string; icon: typeof PenLine }[] = [
  { type: 'static', label: 'Static', icon: PenLine },
  { type: 'field', label: 'Contact Field', icon: User },
  { type: 'custom_field', label: 'Custom Field', icon: Tags },
  { type: 'data_store', label: 'Data Store', icon: Database },
];

interface Step3Props {
  template: MessageTemplate;
  /** Campaign-level override for a media-header template's image/video/document,
   *  picked here (moved from Step1) — falls back to the template's own approved sample. */
  headerMediaUrl?: string;
  onHeaderMediaChange: (url: string) => void;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = [
  { value: 'name', label: 'Contact Name' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'company', label: 'Company' },
];

const matchContactFieldOptions: { value: 'phone' | 'email' | 'name'; label: string }[] = [
  { value: 'phone', label: 'Contact Phone' },
  { value: 'email', label: 'Contact Email' },
  { value: 'name', label: 'Contact Name' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  account_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function Step3Personalize({
  template,
  headerMediaUrl,
  onHeaderMediaChange,
  variables,
  onUpdate,
  onNext,
  onBack,
}: Step3Props) {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [mediaPopupOpen, setMediaPopupOpen] = useState(false);
  const [mappingPopupOpen, setMappingPopupOpen] = useState(false);
  // Which variable row is expanded (accordion-style) inside the mapping popup.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data Store lookups, cached per table so switching between placeholders
  // that reference the same table doesn't re-fetch.
  const [tableFieldsCache, setTableFieldsCache] = useState<Record<string, DataField[]>>({});
  const [tableRecordsCache, setTableRecordsCache] = useState<Record<string, DataStoreRecord[]>>({});
  const fetchedFieldsRef = useRef<Set<string>>(new Set());
  const fetchedRecordsRef = useRef<Set<string>>(new Set());

  // Load user's custom fields, Data Store tables, + a representative
  // contact for the live preview. Fall back to sample data if no
  // contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fieldsRes, contactsRes, tablesRes] = await Promise.all([
        fetch('/api/custom-fields', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/contacts?limit=1', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/data-tables', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.fields ?? []);
      setDataTables(tablesRes.tables ?? []);
      setLoadingFields(false);

      const contact: Contact | null = contactsRes.contacts?.[0] ?? null;
      setFirstContact(contact);

      if (contact) {
        const cvRes = await fetch(`/api/contacts/${contact.id}/custom-values`, { cache: 'no-store' });
        if (!cancelled && cvRes.ok) {
          const cvJson = await cvRes.json();
          const map = new Map<string, string>();
          for (const row of (cvJson.values ?? []) as { custom_field_id: string; value?: string }[]) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureTableFields = useCallback((tableId: string) => {
    if (fetchedFieldsRef.current.has(tableId)) return;
    fetchedFieldsRef.current.add(tableId);
    fetch(`/api/data-tables/${tableId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.table?.fields) setTableFieldsCache((prev) => ({ ...prev, [tableId]: j.table.fields })); })
      .catch(() => {});
  }, []);

  const ensureTableRecords = useCallback((tableId: string) => {
    if (fetchedRecordsRef.current.has(tableId)) return;
    fetchedRecordsRef.current.add(tableId);
    fetch(`/api/data-tables/${tableId}/records?pageSize=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.records) setTableRecordsCache((prev) => ({ ...prev, [tableId]: j.records })); })
      .catch(() => {});
  }, []);

  // Whenever a placeholder points at a Data Store table, load that
  // table's fields (for the pickers) and a sample of records (for the
  // live preview + record count in field labels).
  useEffect(() => {
    for (const m of Object.values(variables)) {
      if (m?.type === 'data_store' && m.table_id) {
        ensureTableFields(m.table_id);
        ensureTableRecords(m.table_id);
      }
    }
  }, [variables, ensureTableFields, ensureTableRecords]);

  const placeholders = useMemo(() => {
    // Recognizes both Meta's positional ({{1}}, {{2}}) and named
    // ({{customer_name}}) variable formats — a template synced from
    // Meta may use either. See template-variable-keys.ts.
    return extractVariableKeys(template.body_text).map((k) => `{{${k}}}`);
  }, [template.body_text]);

  /**
   * A placeholder is "unmapped" if it doesn't have everything it needs
   * to resolve: static needs a value, field/custom_field need a
   * selected field, data_store needs a table + match field + value
   * field. Blocks Next until every placeholder is fully mapped —
   * otherwise the broadcast would ship with empty strings.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (!mapping) { missing.push(placeholder); continue; }
      if (mapping.type === 'data_store') {
        if (!mapping.table_id || !mapping.match_field_key || !mapping.value?.trim()) missing.push(placeholder);
      } else if (!mapping.value?.trim()) {
        missing.push(placeholder);
      }
    }
    return missing;
  }, [placeholders, variables]);

  function setMapping(key: string, mapping: VariableMapping) {
    onUpdate({ ...variables, [key]: mapping });
  }

  function changeType(key: string, type: VariableType) {
    if (type === 'data_store') {
      setMapping(key, { type: 'data_store', value: '', table_id: '', match_field_key: '', match_contact_field: 'phone' });
    } else {
      setMapping(key, { type, value: '' } as VariableMapping);
    }
  }

  /** Short human summary of a mapping, shown on the collapsed row so you
   *  don't have to expand it just to see what's already set. */
  function summarize(key: string): { label: string; complete: boolean } {
    const mapping = variables[key];
    if (!mapping) return { label: 'Not mapped yet', complete: false };
    if (mapping.type === 'static') {
      return mapping.value?.trim() ? { label: `"${mapping.value}"`, complete: true } : { label: 'Not mapped yet', complete: false };
    }
    if (mapping.type === 'field') {
      const f = contactFields.find((c) => c.value === mapping.value);
      return f ? { label: `Contact — ${f.label}`, complete: true } : { label: 'Not mapped yet', complete: false };
    }
    if (mapping.type === 'custom_field') {
      const f = customFields.find((c) => c.id === mapping.value);
      return f ? { label: `Custom Field — ${f.field_name}`, complete: true } : { label: 'Not mapped yet', complete: false };
    }
    // data_store
    if (!mapping.table_id || !mapping.match_field_key || !mapping.value) {
      return { label: 'Data Store — incomplete', complete: false };
    }
    const table = dataTables.find((t) => t.id === mapping.table_id);
    const field = tableFieldsCache[mapping.table_id]?.find((f) => f.field_key === mapping.value);
    return { label: `Data Store — ${table?.name ?? '…'} · ${field?.label ?? mapping.value}`, complete: true };
  }

  const mappedCount = placeholders.filter((p) => summarize(p.replace(/^\{\{|\}\}$/g, '')).complete).length;

  /** Best-effort client-side mirror of resolve-data-store.ts, using the
   *  first page of cached records — good enough for a live preview;
   *  the real send resolves against the full table server-side. */
  function dataStorePreviewValue(mapping: Extract<VariableMapping, { type: 'data_store' }>): string | null {
    if (!mapping.table_id || !mapping.match_field_key || !mapping.value) return null;
    const contact = firstContact ?? SAMPLE_CONTACT;
    const rawMatch = mapping.match_contact_field === 'phone' ? contact.phone
      : mapping.match_contact_field === 'email' ? contact.email
      : contact.name;
    const matchVal = rawMatch?.trim().toLowerCase();
    if (!matchVal) return null;
    const records = tableRecordsCache[mapping.table_id];
    if (!records) return null; // still loading
    const matchDigits = mapping.match_contact_field === 'phone' ? digitsOnly(matchVal) : '';
    const record = records.find((r) => {
      const raw = (r.data as Record<string, unknown>)?.[mapping.match_field_key];
      if (raw == null) return false;
      const rawStr = String(raw).trim().toLowerCase();
      if (rawStr === matchVal) return true;
      if (matchDigits && digitsOnly(rawStr) === matchDigits) return true;
      return false;
    });
    if (!record) return null;
    const val = (record.data as Record<string, unknown>)?.[mapping.value];
    return val != null ? String(val) : null;
  }

  /**
   * Substitute placeholders using the first real contact where
   * possible. Placeholders keyed by "{{N}}" map to variable key "N".
   */
  const previewText = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    // Mapping is never mandatory — an unmapped placeholder, or one that
    // resolves to nothing for this contact, sends as a single space
    // rather than failing (see orBlankSpace in resolve-variables.ts).
    // The preview mirrors that so it shows what actually gets sent.
    let text = template.body_text;
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      let replacement = ' ';

      if (mapping) {
        if (mapping.type === 'static') {
          replacement = mapping.value?.trim() ? mapping.value : ' ';
        } else if (mapping.type === 'field') {
          const fieldMap: Record<string, string | undefined> = {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            company: contact.company,
          };
          const v = mapping.value ? fieldMap[mapping.value] : undefined;
          replacement = v?.trim() ? v : ' ';
        } else if (mapping.type === 'custom_field') {
          const v = mapping.value ? customValues.get(mapping.value) : undefined;
          replacement = v?.trim() ? v : ' ';
        } else if (mapping.type === 'data_store') {
          const v = dataStorePreviewValue(mapping);
          replacement = v?.trim() ? v : ' ';
        }
      }
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataStorePreviewValue closes over tableRecordsCache/firstContact, both already deps below
  }, [
    template.body_text,
    variables,
    placeholders,
    firstContact,
    firstContactCustomValues,
    tableRecordsCache,
  ]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : 'sample data';

  const mediaType = template.header_type;
  const needsMedia = mediaType === 'image' || mediaType === 'video' || mediaType === 'document';
  const MediaIcon = needsMedia ? MEDIA_ICON[mediaType!] : null;
  // Templates synced from Meta only carry a real, reusable header_media_url
  // when one was set directly in this app — Meta's own template API never
  // returns a sendable media URL/id for the sample used at approval time.
  // So for most synced media-header templates, this campaign upload is the
  // ONLY way the send will actually carry an image/video/document.
  const hasDefaultMedia = !!template.header_media_url;
  const mediaRequired = needsMedia && !hasDefaultMedia;
  const mediaMissing = needsMedia && !headerMediaUrl && !template.header_media_url;

  async function handleFilePick(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data?.error ?? 'Upload failed'); return; }
      onHeaderMediaChange(data.url as string);
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  // Mapping is never mandatory — an unmapped variable just sends as a
  // blank space (see resolve-variables.ts's orBlankSpace) instead of
  // blocking the broadcast. Media is still required when the template
  // has no default Meta can fall back to, since that failure mode is a
  // hard API rejection rather than a merely-blank placeholder.
  const canContinue = !mediaMissing;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900 sm:text-lg">Personalize Message</h2>
        <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
          Attach media and map template variables before sending.
        </p>
      </div>

      {/* Top nav — mirrors the bottom bar so long variable lists don't
          force a scroll just to move to the next step. */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-4">
        <Button variant="outline" onClick={onBack} className="h-9 border-slate-200 text-slate-800/80">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canContinue}
          className="h-9 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Two summary buttons — each opens its own popup instead of
          showing every control on the page at once. */}
      <div className="space-y-2.5">
        {needsMedia && (
          <button
            type="button"
            onClick={() => setMediaPopupOpen(true)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all hover:shadow-sm',
              mediaRequired && !headerMediaUrl ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400' : 'border-slate-200 bg-white hover:border-primary/40',
            )}
          >
            {headerMediaUrl ? (
              mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerMediaUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                  {MediaIcon && <MediaIcon className="h-5 w-5 text-indigo-500" />}
                </div>
              )
            ) : (
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', mediaRequired ? 'bg-amber-100' : 'bg-indigo-50')}>
                {MediaIcon && <MediaIcon className={cn('h-5 w-5', mediaRequired ? 'text-amber-600' : 'text-indigo-500')} />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[13px] font-semibold text-slate-800">Header Media</p>
                {mediaRequired && !headerMediaUrl && (
                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Required</span>
                )}
              </div>
              <p className="truncate text-[12px] text-slate-500">
                {headerMediaUrl ? headerMediaUrl.split('/').pop() : mediaRequired ? 'Not attached — send will fail without one' : 'Optional — uses the template’s sample media'}
              </p>
            </div>
            {headerMediaUrl ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : mediaRequired ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        )}

        {placeholders.length > 0 && (
          <button
            type="button"
            onClick={() => setMappingPopupOpen(true)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all hover:shadow-sm',
              unmappedKeys.length > 0 ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400' : 'border-slate-200 bg-white hover:border-primary/40',
            )}
          >
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', unmappedKeys.length > 0 ? 'bg-amber-100' : 'bg-indigo-50')}>
              <Sparkles className={cn('h-5 w-5', unmappedKeys.length > 0 ? 'text-amber-600' : 'text-indigo-500')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800">Variable Mapping</p>
              <p className="text-[12px] text-slate-500">
                {placeholders.length} placeholder{placeholders.length !== 1 ? 's' : ''} · {mappedCount} mapped
                {unmappedKeys.length > 0 && `, ${unmappedKeys.length} missing`}
              </p>
            </div>
            {unmappedKeys.length > 0 ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        )}

        {placeholders.length === 0 && !needsMedia && (
          <div className="rounded-2xl border border-slate-200 bg-white/50 p-6 text-center">
            <p className="text-sm text-slate-500">This template has no variables or media to configure.</p>
          </div>
        )}
      </div>

      {/* Media popup */}
      <Dialog open={mediaPopupOpen} onOpenChange={setMediaPopupOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-md">
          <DialogHeader className={cn('bg-gradient-to-br px-6 pb-5 pt-6', mediaRequired ? 'from-amber-50 to-white' : 'from-indigo-50 to-white')}>
            <div className={cn('mb-1 flex h-11 w-11 items-center justify-center rounded-2xl', mediaRequired ? 'bg-amber-100' : 'bg-indigo-100')}>
              {MediaIcon && <MediaIcon className={cn('h-5 w-5', mediaRequired ? 'text-amber-600' : 'text-indigo-600')} />}
            </div>
            <DialogTitle className="text-[17px] font-bold text-slate-800">
              {mediaType === 'image' ? 'Header Image' : mediaType === 'video' ? 'Header Video' : 'Header Document'}
            </DialogTitle>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {mediaRequired
                ? 'This template has no default media Meta can reuse at send time — upload one for this broadcast or the send will fail.'
                : "Optional — pick media for this specific broadcast, or leave blank to reuse the template's approved sample media."}
            </p>
          </DialogHeader>

          <div className="space-y-3 px-6 pb-6 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={mediaType ? MEDIA_ACCEPT[mediaType] : undefined}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); e.target.value = ''; }}
            />

            {headerMediaUrl ? (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                {mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={headerMediaUrl} alt="Header media" className="h-14 w-14 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-50">
                    {MediaIcon && <MediaIcon className="h-6 w-6 text-indigo-500" />}
                  </div>
                )}
                <p className="flex-1 truncate text-[12.5px] text-slate-600">{headerMediaUrl.split('/').pop()}</p>
                <button type="button" onClick={() => onHeaderMediaChange('')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className={cn('flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-white text-[12.5px] font-medium disabled:opacity-50',
                  mediaRequired ? 'border-amber-300 text-amber-600 hover:border-amber-400 hover:bg-amber-50/50' : 'border-indigo-200 text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/50')}>
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                {uploading ? 'Uploading…' : 'Click to upload'}
              </button>
            )}

            <Button onClick={() => setMediaPopupOpen(false)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mapping popup — a scrollable accordion list of every placeholder;
          tap a row to expand its mapping form inline (no nested dialog). */}
      <Dialog open={mappingPopupOpen} onOpenChange={(v) => { setMappingPopupOpen(v); if (!v) setExpandedKey(null); }}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-lg">
          <DialogHeader className="bg-gradient-to-br from-indigo-50 to-white px-6 pb-5 pt-6">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100">
              <Sparkles className="h-5 w-5 text-indigo-600" />
            </div>
            <DialogTitle className="text-[17px] font-bold text-slate-800">Variable Mapping</DialogTitle>
            <p className="mt-0.5 text-[12px] text-slate-400">
              Map each variable to a contact field, custom field, Data Store record, or static value.
            </p>
          </DialogHeader>

          <div className="flex-1 space-y-2 overflow-y-auto px-6 pb-6 pt-1">
            {placeholders.map((placeholder) => {
              const key = placeholder.replace(/^\{\{|\}\}$/g, '');
              const mapping: VariableMapping = variables[key] ?? { type: 'static', value: '' };
              const dsMapping = mapping.type === 'data_store' ? mapping : null;
              const dsFields = dsMapping?.table_id ? tableFieldsCache[dsMapping.table_id] : undefined;
              const { label, complete } = summarize(key);
              const expanded = expandedKey === key;

              return (
                <div key={placeholder} className="overflow-hidden rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setExpandedKey(expanded ? null : key)}
                    className="flex w-full items-center justify-between gap-3 bg-white p-3.5 text-left"
                  >
                    <div className="min-w-0">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary">
                        {placeholder}
                      </span>
                      <p className={cn('mt-1.5 truncate text-[12.5px]', complete ? 'text-slate-600' : 'text-amber-600')}>{label}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                      {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <Pencil className="h-3.5 w-3.5 text-slate-400" />}
                    </div>
                  </button>

                  {expanded && (
                    <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4">
                      {/* Mapping type — icon tiles instead of a plain dropdown. */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {MAPPING_TYPE_TILES.map((tile) => {
                          const selected = mapping.type === tile.type;
                          const TileIcon = tile.icon;
                          return (
                            <button
                              key={tile.type}
                              type="button"
                              onClick={() => changeType(key, tile.type)}
                              className={cn(
                                'flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 transition-all',
                                selected ? 'border-indigo-400 bg-indigo-50 shadow-sm ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300',
                              )}
                            >
                              <TileIcon className={cn('h-4.5 w-4.5', selected ? 'text-indigo-600' : 'text-slate-400')} />
                              <span className={cn('text-[10.5px] font-semibold leading-tight text-center', selected ? 'text-indigo-700' : 'text-slate-500')}>{tile.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {mapping.type === 'static' && (
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-500">Value</label>
                          <Input
                            value={mapping.value}
                            onChange={(e) => setMapping(key, { type: 'static', value: e.target.value })}
                            placeholder="Enter value..."
                            className="border-slate-200 bg-white text-slate-800 placeholder:text-slate-500"
                          />
                        </div>
                      )}

                      {mapping.type === 'field' && (
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-500">Field</label>
                          <Select
                            value={mapping.value || undefined}
                            onValueChange={(val) => setMapping(key, { type: 'field', value: val || '' })}
                          >
                            <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                              <SelectValue placeholder="Select field..." />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white">
                              {contactFields.map((field) => (
                                <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {mapping.type === 'custom_field' && (
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-500">Field</label>
                          <Select
                            value={mapping.value || undefined}
                            onValueChange={(val) => setMapping(key, { type: 'custom_field', value: val || '' })}
                          >
                            <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                              <SelectValue
                                placeholder={loadingFields ? 'Loading…' : customFields.length === 0 ? 'No custom fields' : 'Select custom field…'}
                              />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white">
                              {customFields.map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.field_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {mapping.type === 'data_store' && (
                        <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600">
                            <Database className="h-3.5 w-3.5" /> Data Store lookup
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">Table</label>
                            <Select
                              value={dsMapping!.table_id || undefined}
                              onValueChange={(val) => setMapping(key, { type: 'data_store', value: '', table_id: val ?? '', match_field_key: '', match_contact_field: dsMapping!.match_contact_field })}
                            >
                              <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                                <SelectValue placeholder={dataTables.length === 0 ? 'No Data Store tables' : 'Select a table…'} />
                              </SelectTrigger>
                              <SelectContent className="border-slate-200 bg-white">
                                {dataTables.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-slate-500">Match customers by</label>
                              <Select
                                value={dsMapping!.match_contact_field}
                                onValueChange={(val) => setMapping(key, { ...dsMapping!, match_contact_field: (val ?? 'phone') as 'phone' | 'email' | 'name' })}
                              >
                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-slate-200 bg-white">
                                  {matchContactFieldOptions.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-slate-500">Matches this table field</label>
                              <Select
                                value={dsMapping!.match_field_key || undefined}
                                disabled={!dsMapping!.table_id}
                                onValueChange={(val) => setMapping(key, { ...dsMapping!, match_field_key: val ?? '' })}
                              >
                                <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                                  <SelectValue placeholder={!dsMapping!.table_id ? 'Pick a table first' : dsFields ? 'Select field…' : 'Loading…'} />
                                </SelectTrigger>
                                <SelectContent className="border-slate-200 bg-white">
                                  {(dsFields ?? []).map((f) => (
                                    <SelectItem key={f.id} value={f.field_key}>{f.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">Insert value from</label>
                            <Select
                              value={dsMapping!.value || undefined}
                              disabled={!dsMapping!.table_id}
                              onValueChange={(val) => setMapping(key, { ...dsMapping!, value: val ?? '' })}
                            >
                              <SelectTrigger className="w-full border-slate-200 bg-white text-slate-800">
                                <SelectValue placeholder={!dsMapping!.table_id ? 'Pick a table first' : dsFields ? 'Select field…' : 'Loading…'} />
                              </SelectTrigger>
                              <SelectContent className="border-slate-200 bg-white">
                                {(dsFields ?? []).map((f) => (
                                  <SelectItem key={f.id} value={f.field_key}>{f.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-100 px-6 py-4">
            <Button onClick={() => setMappingPopupOpen(false)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Live Preview — an authentic WhatsApp-style bubble inside a
          centered phone frame with a capped, scrollable message area so
          a long template body never stretches the page layout. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:rounded-3xl sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-slate-800">Live Preview</p>
          <span className="text-xs text-slate-500">({previewLabel})</span>
          {loadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        </div>

        {mediaMissing && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-[12px] text-amber-700">
              No {template.header_type} attached for this campaign, and this template has no default media Meta can reuse —
              tap <span className="font-semibold">Header Media</span> above, or the send will fail.
            </p>
          </div>
        )}

        <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[26px] border-4 border-slate-900/5 shadow-lg">
          <div
            className="max-h-[440px] overflow-y-auto p-3 sm:p-4"
            style={{
              backgroundColor: '#e5ddd5',
              backgroundImage:
                'radial-gradient(circle at 12% 22%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 82% 72%, rgba(255,255,255,0.3) 0, transparent 45%)',
            }}
          >
            <div className="flex flex-col items-end">
              {/* Bubble */}
              <div className="relative max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
                <span
                  className="absolute right-[-8px] top-0 h-0 w-0"
                  style={{ borderTop: '8px solid #d9fdd3', borderRight: '8px solid transparent' }}
                />

                {/* Media header */}
                {template.header_type === 'image' && (
                  <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-slate-200">
                    {(headerMediaUrl || template.header_media_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={headerMediaUrl || template.header_media_url} alt="" className="max-h-48 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-slate-400">
                        <ImageIcon className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                )}
                {template.header_type === 'video' && (
                  <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-black">
                    {(headerMediaUrl || template.header_media_url) ? (
                      <video src={headerMediaUrl || template.header_media_url} controls muted className="max-h-48 w-full" />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-white/70">
                        <Play className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                )}
                {template.header_type === 'document' && (
                  <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-black/5 p-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100">
                      <FileText className="h-4.5 w-4.5 text-rose-500" />
                    </div>
                    <p className="truncate text-[12px] text-[#111b21]">
                      {(headerMediaUrl || template.header_media_url)?.split('/').pop() ?? 'Document'}
                    </p>
                  </div>
                )}

                <div className="px-3 pb-1.5 pt-2">
                  {template.header_type === 'text' && template.header_content && (
                    <p className="mb-1 text-[14.2px] font-bold leading-snug text-[#111b21]">
                      {template.header_content}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-[14.2px] leading-[19px] text-[#111b21]">
                    {previewText}
                  </p>
                  {template.footer_text && (
                    <p className="mt-1 text-[13px] text-[#667781]">{template.footer_text}</p>
                  )}
                  <div className="flex items-center justify-end gap-1 pt-1">
                    <span className="text-[11px] text-[#667781]">
                      {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <svg viewBox="0 0 16 11" className="h-2.5 w-3.5" fill="none">
                      <path d="M1 5.5L4.5 9 11 1.5" stroke="#53bdeb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5 5.5L8.5 9 15 1.5" stroke="#53bdeb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Buttons card — WhatsApp renders template buttons in their
                  own white card directly under the bubble, one row each. */}
              {template.buttons && template.buttons.length > 0 && (
                <div className="mt-0.5 w-full max-w-[92%] overflow-hidden rounded-lg bg-white shadow-sm">
                  {template.buttons.map((b, i) => {
                    const Icon =
                      b.type === 'URL' ? ExternalLink :
                      b.type === 'PHONE_NUMBER' ? Phone :
                      b.type === 'COPY_CODE' ? Copy :
                      b.type === 'FLOW' ? Zap :
                      Reply;
                    return (
                      <div key={i} className={`flex items-center justify-center gap-2 py-2.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                        <Icon className="h-3.5 w-3.5 text-[#00a5f4]" />
                        <span className="text-[14px] font-medium text-[#00a5f4]">{b.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">{unmappedKeys.join(', ')}</span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} className="h-9 border-slate-200 text-slate-800/80">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canContinue}
          className="h-9 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
