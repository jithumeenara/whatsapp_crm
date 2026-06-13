'use client';

import { useState, useEffect } from 'react';
import {
  Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Loader2, Check, X, Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  DataField, DataTable, FieldType, SelectOption, FieldValidation,
} from '@/lib/data-store/types';
import {
  FIELD_TYPES, FIELD_GROUPS, CHOICE_FIELD_TYPES,
  getSelectItems, getFieldConfig,
} from '@/lib/data-store/types';

interface Props {
  tableId: string;
  fields: DataField[];
  allTables: DataTable[];
  onFieldsChange: (fields: DataField[]) => void;
}

interface FieldFormState {
  label: string;
  field_type: FieldType;
  required: boolean;
  // Choice types — manual or from-table
  select_items: SelectOption[];
  choice_source: 'manual' | 'table';
  source_table_id: string;
  source_field_key: string;
  // Relation type
  relation_table_id: string;
  relation_label_field: string;
  // Common config
  placeholder: string;
  default_value: string;
  help_text: string;
  field_width: 'full' | 'half' | 'third';
  // Validation
  validation: FieldValidation;
  // Special
  hidden_value: string;
  content: string;
}

const BLANK_FORM: FieldFormState = {
  label: '',
  field_type: 'text',
  required: false,
  select_items: [{ label: '', value: '' }],
  choice_source: 'manual',
  source_table_id: '',
  source_field_key: '',
  relation_table_id: '',
  relation_label_field: '',
  placeholder: '',
  default_value: '',
  help_text: '',
  field_width: 'full',
  validation: {},
  hidden_value: '',
  content: '',
};

function buildOptions(form: FieldFormState): Record<string, unknown> | null {
  const cfg: Record<string, unknown> = {};
  if (CHOICE_FIELD_TYPES.has(form.field_type)) {
    if (form.choice_source === 'table' && form.source_table_id) {
      cfg.source_table_id = form.source_table_id;
      cfg.source_field_key = form.source_field_key || '';
    } else {
      cfg.select_items = form.select_items.filter((o) => o.label.trim());
    }
  }
  if (form.placeholder) cfg.placeholder = form.placeholder;
  if (form.default_value) cfg.default_value = form.default_value;
  if (form.help_text) cfg.help_text = form.help_text;
  if (form.field_width !== 'full') cfg.field_width = form.field_width;
  if (form.hidden_value) cfg.hidden_value = form.hidden_value;
  if (form.content) cfg.content = form.content;
  const v = form.validation;
  if (v.min != null || v.max != null || v.minLength != null || v.maxLength != null || v.pattern || v.custom_message) {
    cfg.validation = Object.fromEntries(Object.entries(v).filter(([, val]) => val != null && val !== ''));
  }
  return Object.keys(cfg).length ? cfg : null;
}

export function FieldEditor({ tableId, fields, allTables, onFieldsChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FieldFormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'display' | 'validation'>('basic');
  // Fields fetched on-demand for the "from a table" source picker
  const [sourceFields, setSourceFields] = useState<DataField[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);

  // Fetch fields whenever the selected source table changes
  useEffect(() => {
    if (!form.source_table_id) { setSourceFields([]); return; }
    setLoadingSource(true);
    fetch(`/api/data-tables/${form.source_table_id}`)
      .then((r) => r.json())
      .then((d) => setSourceFields(d.table?.fields ?? []))
      .catch(() => setSourceFields([]))
      .finally(() => setLoadingSource(false));
  }, [form.source_table_id]);

  const openNew = () => {
    setForm(BLANK_FORM);
    setActiveTab('basic');
    setEditing('new');
  };

  const openEdit = (f: DataField) => {
    const cfg = getFieldConfig(f.options);
    const items = getSelectItems(f.options);
    setForm({
      label: f.label,
      field_type: f.field_type,
      required: f.required,
      select_items: items.length > 0 ? items : [{ label: '', value: '' }],
      choice_source: cfg.source_table_id ? 'table' : 'manual',
      source_table_id: String(cfg.source_table_id ?? ''),
      source_field_key: String(cfg.source_field_key ?? ''),
      relation_table_id: f.relation_table_id ?? '',
      relation_label_field: f.relation_label_field ?? '',
      placeholder: String(cfg.placeholder ?? ''),
      default_value: String(cfg.default_value ?? ''),
      help_text: String(cfg.help_text ?? ''),
      field_width: (cfg.field_width as FieldFormState['field_width']) ?? 'full',
      validation: cfg.validation ?? {},
      hidden_value: String(cfg.hidden_value ?? ''),
      content: String(cfg.content ?? ''),
    });
    setActiveTab('basic');
    setEditing(f.id);
  };

  const cancel = () => { setEditing(null); setForm(BLANK_FORM); };

  const set = <K extends keyof FieldFormState>(key: K, value: FieldFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setVal = <K extends keyof FieldValidation>(key: K, value: FieldValidation[K]) =>
    setForm((f) => ({ ...f, validation: { ...f.validation, [key]: value } }));

  const save = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      const payload = {
        label: form.label.trim(),
        field_type: form.field_type,
        required: form.required,
        options: buildOptions(form),
        relation_table_id: form.field_type === 'relation' ? form.relation_table_id || null : null,
        relation_label_field: form.field_type === 'relation' ? form.relation_label_field || null : null,
      };

      if (editing === 'new') {
        const res = await fetch(`/api/data-tables/${tableId}/fields`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok) onFieldsChange([...fields, data.field]);
      } else {
        const res = await fetch(`/api/data-tables/${tableId}/fields/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok) onFieldsChange(fields.map((f) => f.id === editing ? data.field : f));
      }
      cancel();
    } finally {
      setSaving(false);
    }
  };

  const deleteField = async (fieldId: string) => {
    setDeleting(fieldId);
    try {
      await fetch(`/api/data-tables/${tableId}/fields/${fieldId}`, { method: 'DELETE' });
      onFieldsChange(fields.filter((f) => f.id !== fieldId));
    } finally {
      setDeleting(null);
    }
  };

  const moveField = async (fieldId: string, direction: 'up' | 'down') => {
    const idx = fields.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= fields.length) return;
    const newFields = [...fields];
    [newFields[idx], newFields[swapIdx]] = [newFields[swapIdx], newFields[idx]];
    onFieldsChange(newFields);
    await Promise.all([
      fetch(`/api/data-tables/${tableId}/fields/${newFields[idx].id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: idx }),
      }),
      fetch(`/api/data-tables/${tableId}/fields/${newFields[swapIdx].id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: swapIdx }),
      }),
    ]);
  };

  const addOption = () =>
    set('select_items', [...form.select_items, { label: '', value: '' }]);

  const updateOption = (i: number, label: string) =>
    set('select_items', form.select_items.map((o, idx) =>
      idx === i ? { label, value: label.toLowerCase().replace(/\s+/g, '_') } : o,
    ));

  const removeOption = (i: number) =>
    set('select_items', form.select_items.filter((_, idx) => idx !== i));

  const relationTable = allTables.find((t) => t.id === form.relation_table_id);
  const relationFields = relationTable?.fields ?? [];

  const isChoiceType = CHOICE_FIELD_TYPES.has(form.field_type);
  const isDisplayType = form.field_type === 'section_header' || form.field_type === 'html_block';
  const isHiddenType = form.field_type === 'hidden';
  const isRelationType = form.field_type === 'relation';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Fields ({fields.length})</p>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5 h-8 text-xs">
          <Plus className="size-3.5" />
          Add Field
        </Button>
      </div>

      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          No fields yet. Add your first field to get started.
        </div>
      )}

      <div className="space-y-1.5">
        {fields.map((field, idx) => {
          const cfg = getFieldConfig(field.options);
          return (
            <div key={field.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
              <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{field.label}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{FIELD_TYPES.find((t) => t.value === field.field_type)?.label ?? field.field_type}</span>
                  {field.required && <span className="text-destructive">required</span>}
                  {cfg.field_width && cfg.field_width !== 'full' && (
                    <span className="text-primary/70">{cfg.field_width} width</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => moveField(field.id, 'up')} disabled={idx === 0}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                  <ChevronUp className="size-3.5" />
                </button>
                <button type="button" onClick={() => moveField(field.id, 'down')} disabled={idx === fields.length - 1}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                  <ChevronDown className="size-3.5" />
                </button>
                <button type="button" onClick={() => openEdit(field)}
                  className="p-1 text-muted-foreground hover:text-primary transition-colors">
                  <Settings2 className="size-3.5" />
                </button>
                <button type="button" onClick={() => deleteField(field.id)} disabled={deleting === field.id}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                  {deleting === field.id
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Field dialog */}
      <Dialog open={editing !== null} onOpenChange={(v) => !v && cancel()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add Field' : 'Edit Field'}</DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="h-8 text-xs">
              <TabsTrigger value="basic" className="text-xs px-3">Basic</TabsTrigger>
              <TabsTrigger value="display" className="text-xs px-3">Display</TabsTrigger>
              <TabsTrigger value="validation" className="text-xs px-3">Validation</TabsTrigger>
            </TabsList>

            {/* ── BASIC TAB ─────────────────────────────── */}
            <TabsContent value="basic" className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label>Field Label *</Label>
                <Input
                  placeholder="e.g. Full Name, Date of Birth"
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label>Field Type</Label>
                <Select
                  value={form.field_type}
                  onValueChange={(v) => v && set('field_type', v as FieldType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {FIELD_GROUPS.map((group) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-xs text-muted-foreground py-1">{group}</SelectLabel>
                        {FIELD_TYPES.filter((ft) => ft.group === group).map((ft) => (
                          <SelectItem key={ft.value} value={ft.value} className="text-sm">
                            {ft.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Choice options (select / multiselect / radio) */}
              {isChoiceType && (
                <div className="space-y-3">
                  <Label>Options Source</Label>
                  {/* Toggle: manual vs from table */}
                  <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                    {(['manual', 'table'] as const).map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => set('choice_source', src)}
                        className={cn(
                          'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                          form.choice_source === src
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {src === 'manual' ? 'Manual options' : 'From a table'}
                      </button>
                    ))}
                  </div>

                  {form.choice_source === 'manual' && (
                    <div className="space-y-2">
                      {form.select_items.map((opt, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            placeholder={`Option ${i + 1}`}
                            value={opt.label}
                            onChange={(e) => updateOption(i, e.target.value)}
                            className="text-sm"
                          />
                          {form.select_items.length > 1 && (
                            <button type="button" onClick={() => removeOption(i)}
                              className="text-muted-foreground hover:text-destructive transition-colors">
                              <X className="size-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={addOption} className="gap-1.5 text-xs h-7">
                        <Plus className="size-3" /> Add option
                      </Button>
                    </div>
                  )}

                  {form.choice_source === 'table' && (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Source Table</Label>
                        <Select
                          value={form.source_table_id}
                          onValueChange={(v) => { if (v) { setForm((f) => ({ ...f, source_table_id: v, source_field_key: '' })); setSourceFields([]); } }}
                        >
                          <SelectTrigger className="text-sm"><SelectValue placeholder="Pick a table…" /></SelectTrigger>
                          <SelectContent>
                            {allTables.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {form.source_table_id && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Use Field Values As Options</Label>
                          {loadingSource ? (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
                              <Loader2 className="size-3 animate-spin" /> Loading fields…
                            </div>
                          ) : (
                            <Select
                              value={form.source_field_key}
                              onValueChange={(v) => v && set('source_field_key', v)}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder={sourceFields.length === 0 ? 'No fields in this table' : 'Pick a field…'} />
                              </SelectTrigger>
                              <SelectContent>
                                {sourceFields
                                  .filter((f) => !['section_header', 'html_block', 'signature', 'file', 'image'].includes(f.field_type))
                                  .map((f) => (
                                    <SelectItem key={f.field_key} value={f.field_key}>{f.label}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Dropdown will show unique values from this field at record creation time.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Relation config */}
              {isRelationType && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Link to Table</Label>
                    <Select
                      value={form.relation_table_id}
                      onValueChange={(v) => v && setForm((f) => ({ ...f, relation_table_id: v, relation_label_field: '' }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select a table…" /></SelectTrigger>
                      <SelectContent>
                        {allTables.filter((t) => t.id !== tableId).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {relationFields.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Display Field</Label>
                      <Select
                        value={form.relation_label_field}
                        onValueChange={(v) => v && set('relation_label_field', v)}
                      >
                        <SelectTrigger><SelectValue placeholder="Which field to show?" /></SelectTrigger>
                        <SelectContent>
                          {relationFields.map((rf) => (
                            <SelectItem key={rf.field_key} value={rf.field_key}>{rf.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* Hidden field value */}
              {isHiddenType && (
                <div className="space-y-1.5">
                  <Label>Hidden Value</Label>
                  <Input
                    placeholder="Value saved silently with each record"
                    value={form.hidden_value}
                    onChange={(e) => set('hidden_value', e.target.value)}
                  />
                </div>
              )}

              {/* Section header / HTML block content */}
              {isDisplayType && (
                <div className="space-y-1.5">
                  <Label>{form.field_type === 'html_block' ? 'HTML Content' : 'Description (optional)'}</Label>
                  <Textarea
                    placeholder={form.field_type === 'html_block'
                      ? '<p>Your HTML here…</p>'
                      : 'Optional subtitle below the section heading'}
                    value={form.content}
                    onChange={(e) => set('content', e.target.value)}
                    rows={form.field_type === 'html_block' ? 4 : 2}
                    className="text-sm font-mono"
                  />
                </div>
              )}

              {/* Required toggle — not for display types */}
              {!isDisplayType && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.required}
                    onChange={(e) => set('required', e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm">Required field</span>
                </label>
              )}
            </TabsContent>

            {/* ── DISPLAY TAB ───────────────────────────── */}
            <TabsContent value="display" className="space-y-4 pt-3">
              {!isDisplayType && !isHiddenType && (
                <>
                  <div className="space-y-1.5">
                    <Label>Placeholder</Label>
                    <Input
                      placeholder="Hint text shown inside the field…"
                      value={form.placeholder}
                      onChange={(e) => set('placeholder', e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Default Value</Label>
                    <Input
                      placeholder="Pre-filled value for new records"
                      value={form.default_value}
                      onChange={(e) => set('default_value', e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label>Help Text</Label>
                <Textarea
                  placeholder="Instruction shown below the field to guide users"
                  value={form.help_text}
                  onChange={(e) => set('help_text', e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Field Width</Label>
                <Select
                  value={form.field_width}
                  onValueChange={(v) => v && set('field_width', v as FieldFormState['field_width'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full width</SelectItem>
                    <SelectItem value="half">Half width (50%)</SelectItem>
                    <SelectItem value="third">Third width (33%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* ── VALIDATION TAB ────────────────────────── */}
            <TabsContent value="validation" className="space-y-4 pt-3">
              {(form.field_type === 'number') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min Value</Label>
                    <Input type="number" value={form.validation.min ?? ''} placeholder="0"
                      onChange={(e) => setVal('min', e.target.value ? Number(e.target.value) : undefined)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Value</Label>
                    <Input type="number" value={form.validation.max ?? ''} placeholder="100"
                      onChange={(e) => setVal('max', e.target.value ? Number(e.target.value) : undefined)} />
                  </div>
                </div>
              )}

              {(form.field_type === 'text' || form.field_type === 'textarea' || form.field_type === 'password' || form.field_type === 'url') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min Length</Label>
                    <Input type="number" value={form.validation.minLength ?? ''} placeholder="0"
                      onChange={(e) => setVal('minLength', e.target.value ? Number(e.target.value) : undefined)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Length</Label>
                    <Input type="number" value={form.validation.maxLength ?? ''} placeholder="255"
                      onChange={(e) => setVal('maxLength', e.target.value ? Number(e.target.value) : undefined)} />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Pattern (regex)</Label>
                <Input
                  placeholder="e.g. ^[A-Z]{2}[0-9]{6}$"
                  value={form.validation.pattern ?? ''}
                  onChange={(e) => setVal('pattern', e.target.value || undefined)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Custom Validation Message</Label>
                <Input
                  placeholder="Shown when validation fails"
                  value={form.validation.custom_message ?? ''}
                  onChange={(e) => setVal('custom_message', e.target.value || undefined)}
                />
              </div>

              {form.field_type === 'text' && (
                <p className="text-xs text-muted-foreground">
                  Leave validation empty to accept any value.
                </p>
              )}
              {form.field_type === 'number' && (
                <p className="text-xs text-muted-foreground">
                  Leave Min/Max empty to allow any number.
                </p>
              )}
              {isDisplayType && (
                <p className="text-xs text-muted-foreground">
                  Display fields don't support validation.
                </p>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.label.trim()} className="gap-2">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {editing === 'new' ? 'Add Field' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
