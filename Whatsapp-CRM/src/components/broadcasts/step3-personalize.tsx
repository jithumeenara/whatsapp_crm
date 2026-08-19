'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Contact, CustomField, MessageTemplate } from '@/types';
import type { VariableMapping } from '@/lib/broadcasts/resolve-variables';
import type { DataTable, DataField, DataRecord as DataStoreRecord } from '@/lib/data-store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, ArrowRight, Eye, Loader2, Database,
  Reply, ExternalLink, Phone, Copy, Zap, FileText, Play, Image as ImageIcon,
} from 'lucide-react';

type VariableType = VariableMapping['type'];

interface Step3Props {
  template: MessageTemplate;
  /** Campaign-level override for a media-header template's image/video/document,
   *  chosen in Step1 — falls back to the template's own approved sample media. */
  headerMediaUrl?: string;
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
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
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

    let text = template.body_text;
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      let replacement = placeholder;

      if (mapping) {
        if (mapping.type === 'static' && mapping.value) {
          replacement = mapping.value;
        } else if (mapping.type === 'field' && mapping.value) {
          const fieldMap: Record<string, string | undefined> = {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            company: contact.company,
          };
          replacement = fieldMap[mapping.value] ?? placeholder;
        } else if (mapping.type === 'custom_field' && mapping.value) {
          replacement = customValues.get(mapping.value) || placeholder;
        } else if (mapping.type === 'data_store') {
          replacement = dataStorePreviewValue(mapping) ?? placeholder;
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Personalize Message</h2>
        <p className="mt-1 text-sm text-slate-500">
          Map template variables to contact fields, custom fields, Data
          Store records, or static values.
        </p>
      </div>

      {/* Top nav — mirrors the bottom bar so long variable lists don't
          force a scroll just to move to the next step. */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-200 text-slate-800/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {placeholders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white/50 p-6 text-center">
          <p className="text-sm text-slate-500">
            This template has no variables to personalize.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping: VariableMapping = variables[key] ?? { type: 'static', value: '' };
            const dsMapping = mapping.type === 'data_store' ? mapping : null;
            const dsFields = dsMapping?.table_id ? tableFieldsCache[dsMapping.table_id] : undefined;

            return (
              <div
                key={placeholder}
                className="rounded-xl border border-slate-200 bg-white/50 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-medium text-primary">
                    {placeholder}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">
                      Mapping Type
                    </label>
                    <Select
                      value={mapping.type}
                      onValueChange={(val) => changeType(key, val as VariableType)}
                    >
                      <SelectTrigger className="w-full border-slate-200 bg-slate-100 text-slate-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-slate-200 bg-slate-100">
                        <SelectItem value="static">Static Value</SelectItem>
                        <SelectItem value="field">Contact Field</SelectItem>
                        <SelectItem value="custom_field">
                          Custom Field
                        </SelectItem>
                        <SelectItem value="data_store">
                          Data Store
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {mapping.type !== 'data_store' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        {mapping.type === 'static' ? 'Value' : 'Field'}
                      </label>
                      {mapping.type === 'static' ? (
                        <Input
                          value={mapping.value}
                          onChange={(e) => setMapping(key, { type: 'static', value: e.target.value })}
                          placeholder="Enter value..."
                          className="border-slate-200 bg-slate-100 text-slate-800 placeholder:text-slate-500"
                        />
                      ) : mapping.type === 'field' ? (
                        <Select
                          value={mapping.value || undefined}
                          onValueChange={(val) => setMapping(key, { type: 'field', value: val || '' })}
                        >
                          <SelectTrigger className="w-full border-slate-200 bg-slate-100 text-slate-800">
                            <SelectValue placeholder="Select field..." />
                          </SelectTrigger>
                          <SelectContent className="border-slate-200 bg-slate-100">
                            {contactFields.map((field) => (
                              <SelectItem key={field.value} value={field.value}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select
                          value={mapping.value || undefined}
                          onValueChange={(val) => setMapping(key, { type: 'custom_field', value: val || '' })}
                        >
                          <SelectTrigger className="w-full border-slate-200 bg-slate-100 text-slate-800">
                            <SelectValue
                              placeholder={
                                loadingFields
                                  ? 'Loading…'
                                  : customFields.length === 0
                                    ? 'No custom fields'
                                    : 'Select custom field…'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="border-slate-200 bg-slate-100">
                            {customFields.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.field_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </div>

                {mapping.type === 'data_store' && (
                  <div className="mt-3 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
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
            );
          })}
        </div>
      )}

      {/* Live Preview — an authentic WhatsApp-style bubble: real chat
          wallpaper, bubble tail, media header, footer, timestamp + read
          receipt, and template buttons rendered as their own card
          underneath — the same layout WhatsApp itself renders. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-slate-800">Live Preview</p>
          <span className="text-xs text-slate-500">({previewLabel})</span>
          {loadingPreview && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </div>

        <div
          className="rounded-2xl p-4 sm:p-6"
          style={{
            backgroundColor: '#e5ddd5',
            backgroundImage:
              'radial-gradient(circle at 12% 22%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 82% 72%, rgba(255,255,255,0.3) 0, transparent 45%)',
          }}
        >
          <div className="ml-auto flex max-w-[88%] flex-col items-end sm:max-w-[72%]">
            {/* Bubble */}
            <div className="relative rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
              <span
                className="absolute right-[-8px] top-0 h-0 w-0"
                style={{ borderTop: '8px solid #d9fdd3', borderRight: '8px solid transparent' }}
              />

              {/* Media header */}
              {template.header_type === 'image' && (
                <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-slate-200">
                  {(headerMediaUrl || template.header_media_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={headerMediaUrl || template.header_media_url} alt="" className="max-h-56 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-slate-400">
                      <ImageIcon className="h-7 w-7" />
                    </div>
                  )}
                </div>
              )}
              {template.header_type === 'video' && (
                <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-black">
                  {(headerMediaUrl || template.header_media_url) ? (
                    <video src={headerMediaUrl || template.header_media_url} controls muted className="max-h-56 w-full" />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-white/70">
                      <Play className="h-7 w-7" />
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
              <div className="mt-0.5 w-full overflow-hidden rounded-lg bg-white shadow-sm">
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

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">
            {unmappedKeys.join(', ')}
          </span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-200 text-slate-800/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
