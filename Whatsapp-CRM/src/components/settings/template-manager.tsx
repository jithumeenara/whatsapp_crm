'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
  Upload,
  Maximize2,
  Bold,
  Italic,
  Strikethrough,
  Code,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';
import { templateStatusConfig } from '@/lib/template-status';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = ['none', 'text', 'image', 'video', 'document'];

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
    case 'FLOW':
      return { type: 'FLOW', text: '', flow_id: '', navigate_screen: '', flow_action: 'navigate' };
  }
}

export function TemplateManager() {
  const { userId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [bodyEditorOpen, setBodyEditorOpen] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const [metaFlows, setMetaFlows] = useState<Array<{ dbId: string; metaFlowId: string; name: string }>>([]);
  const [syncingFlows, setSyncingFlows] = useState(false);
  // Map: metaFlowId → screen IDs loaded from Meta
  const [flowScreens, setFlowScreens] = useState<Record<string, string[]>>({});

  // Body variable indices — `[1, 2, 3]` for "{{1}} {{2}} {{3}}". We
  // re-run the extractor on every render to keep the sample-value rows
  // in sync with what the user typed.
  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );

  // Resize body_samples so it always has exactly bodyVarCount entries.
  // (We mutate via setForm in an effect so React owns the state.)
  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push('');
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchTemplates(userId);
    loadMetaFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId]);

  async function fetchTemplates(_userId: string) {
    try {
      setLoading(true);
      const res = await fetch('/api/whatsapp/templates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  function loadMetaFlows() {
    fetch('/api/flows?flow_type=whatsapp_flow')
      .then((r) => r.json())
      .then((d: { flows?: Array<{ id: string; name: string; trigger_config: Record<string, unknown> }> }) => {
        setMetaFlows(
          (d.flows ?? [])
            .filter((f) => f.trigger_config?.meta_flow_id)
            .map((f) => ({
              dbId: f.id,
              metaFlowId: String(f.trigger_config.meta_flow_id),
              name: f.name,
            }))
        );
      })
      .catch(() => {});
  }

  async function handleSyncFlows() {
    setSyncingFlows(true);
    try {
      const res = await fetch('/api/flows/sync', { method: 'POST' });
      const json = await res.json() as { inserted?: number; updated?: number; error?: string };
      if (!res.ok) { toast.error(json.error ?? 'Sync failed'); return; }
      toast.success(`Flows synced — ${json.inserted ?? 0} added, ${json.updated ?? 0} updated`);
      loadMetaFlows();
    } catch {
      toast.error('Could not connect to Meta');
    } finally {
      setSyncingFlows(false);
    }
  }

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || `${isEdit ? 'Edit' : 'Submit'} failed (HTTP ${res.status})`,
        );
      }
      // Refresh first, then close — re-opening the dialog
      // immediately should not show a stale list.
      if (userId) await fetchTemplates(userId);
      toast.success(
        data.dry_run
          ? isEdit
            ? 'Template updated (dry-run — no Meta call)'
            : 'Template saved (dry-run — no Meta call)'
          : isEdit
            ? 'Edit submitted — Meta typically reviews within 24 hours.'
            : 'Submitted to Meta — typical review time is 24 hours. Status updates automatically.',
      );
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!userId) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated
            ? ` (${data.inserted} new, ${data.updated} updated)`
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        // Use error (not warning) so the message survives long
        // enough to read — sonner's `warning` auto-dismisses on
        // the same short timer as `success`.
        toast.error(
          'Synced the first 2000 templates only — your account has more. Sync again to continue, or contact support if this persists.',
          { duration: 10000 },
        );
      }
      await fetchTemplates(userId);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync templates');
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call.
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
    flow_id?: string;
    flow_name?: string;
    navigate_screen?: string;
    flow_action?: 'navigate' | 'data_exchange';
  };
  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'FLOW':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.flow_id !== undefined && { flow_id: patch.flow_id }),
            ...(patch.navigate_screen !== undefined && { navigate_screen: patch.navigate_screen }),
            ...(patch.flow_action !== undefined && { flow_action: patch.flow_action }),
            // flow_name is display-only, stored alongside flow_id for UI rendering
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  async function handleMediaFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingMedia(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Upload failed'); return; }
      setForm((prev) => ({ ...prev, header_media_url: data.url }));
      toast.success('File uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploadingMedia(false);
    }
  }

  // Insert WhatsApp formatting markers around the textarea selection.
  function insertFormatting(marker: string) {
    const el = document.getElementById('template-body-text') as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = form.body_text;
    const selected = text.slice(start, end);
    const replacement = selected ? `${marker}${selected}${marker}` : `${marker}${marker}`;
    const next = text.slice(0, start) + replacement + text.slice(end);
    setForm((prev) => ({ ...prev, body_text: next }));
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + marker.length + selected.length + marker.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Message Templates</h2>
          <p className="text-sm text-muted-foreground">
            Create message templates and submit them to Meta for approval. Use
            &quot;Sync from Meta&quot; to pull templates approved elsewhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            className="border-border bg-transparent text-foreground/80 hover:bg-muted"
            title="Pull approved templates from your Meta WhatsApp Business Account"
          >
            <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Meta'}
          </Button>
          <Button
            onClick={openCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            New Template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="bg-card border-border ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">No templates yet.</p>
            <p className="text-muted-foreground text-xs mt-1">
              Create your first message template to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => {
            const statusKey = template.status || 'DRAFT';
            const status = templateStatusConfig[statusKey];
            return (
              <Card
                key={template.id}
                className="bg-card border-border ring-0 ring-transparent"
              >
                <CardContent className="flex items-start justify-between pt-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{template.name}</h3>
                      <Badge
                        className={`text-xs border ${categoryColors[template.category] || ''}`}
                      >
                        {template.category}
                      </Badge>
                      <Badge className={`text-xs border ${status.classes}`}>
                        {status.label}
                      </Badge>
                      {template.language && (
                        <span className="text-xs text-muted-foreground uppercase">
                          {template.language}
                        </span>
                      )}
                      {template.quality_score && (
                        <span
                          className={`text-[10px] uppercase font-medium ${
                            template.quality_score === 'GREEN'
                              ? 'text-emerald-400'
                              : template.quality_score === 'YELLOW'
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}
                          title="Meta quality score"
                        >
                          {template.quality_score}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.body_text}
                    </p>
                    {template.footer_text && (
                      <p className="text-xs text-muted-foreground italic">
                        {template.footer_text}
                      </p>
                    )}
                    {(template.rejection_reason || template.submission_error) && (
                      <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded px-2 py-1.5">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          {template.rejection_reason || template.submission_error}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {statusKey === 'APPROVED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title="Editing triggers Meta re-review — status flips to PENDING."
                        aria-label="Edit template"
                        className="text-foreground/80 hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    )}
                    {(statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(template)}
                        title="Edit the template and resubmit to Meta for review."
                        aria-label="Edit and resubmit template"
                        className="text-foreground/80 hover:text-primary hover:bg-primary/10 h-8 px-2"
                      >
                        <RotateCcw className="size-3.5" />
                        Resubmit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTemplateToDelete(template)}
                      disabled={deletingId === template.id}
                      aria-label={
                        template.meta_template_id
                          ? 'Delete template from Meta and locally'
                          : 'Delete template locally'
                      }
                      title={
                        template.meta_template_id
                          ? 'Delete from Meta and locally'
                          : 'Delete locally'
                      }
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-8 w-8"
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingId ? 'Edit Message Template' : 'New Message Template'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId
                ? 'Save your changes to re-submit to Meta. Status will flip back to PENDING during review.'
                : 'Build a template and submit it to Meta for approval. Once approved, you can use it in broadcasts and the inbox.'}
            </DialogDescription>
          </DialogHeader>

          {form.category === 'Authentication' && (
            <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <p>
                AUTHENTICATION templates have a fixed body + OTP button shape
                that needs a different builder. Create them in Meta WhatsApp
                Manager for now and use <strong>Sync from Meta</strong> to
                bring them in.
              </p>
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-foreground/80">Template Name</Label>
              <Input
                placeholder="e.g. order_confirmation"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingId !== null}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <p className="text-[11px] text-muted-foreground">
                {editingId
                  ? 'Name is fixed once a template exists on Meta — create a new template to change it.'
                  : 'Lowercase letters, digits, and underscores only.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground/80">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-muted border-border">
                    {CATEGORIES.map((cat) => (
                      <SelectItem
                        key={cat}
                        value={cat}
                        className="text-foreground focus:bg-muted focus:text-foreground"
                      >
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-foreground/80">Language</Label>
                <Input
                  list="template-language-codes"
                  placeholder="en_US"
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value })
                  }
                  disabled={editingId !== null}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <datalist id="template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <p className="text-[11px] text-muted-foreground">
                  {editingId
                    ? 'Language is fixed once a template exists on Meta.'
                    : (
                        <>
                          Must match the exact code on Meta — <code>en_US</code>{' '}
                          and <code>en</code> are distinct.
                        </>
                      )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground/80">Header</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) =>
                  // Preserve header_content, header_media_url, and
                  // header_sample across format switches. The submit
                  // payload builder only reads the field that matches
                  // the active format, so an orphan value on a hidden
                  // field is harmless — and keeping it lets the user
                  // switch formats to compare without losing typing.
                  setForm({
                    ...form,
                    header_format: (val || 'none') as HeaderFormat,
                  })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-foreground focus:bg-muted focus:text-foreground"
                    >
                      {type === 'none'
                        ? 'None'
                        : type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' && (
                <div className="space-y-2 mt-2">
                  <Input
                    id="template-header-text"
                    aria-label="Header text"
                    placeholder="Header text (max 60 chars, optional {{1}})"
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {headerVarCount > 0 && (
                    <Input
                      id="template-header-sample"
                      aria-label="Sample value for header variable"
                      placeholder="Sample value for {{1}} (required for Meta review)"
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {headerNeedsMedia && (
                <div className="space-y-2 mt-2">
                  {/* Hidden file input */}
                  <input
                    ref={mediaFileRef}
                    type="file"
                    className="hidden"
                    accept={
                      form.header_format === 'image'
                        ? 'image/jpeg,image/png,image/webp'
                        : form.header_format === 'video'
                          ? 'video/mp4,video/3gpp'
                          : 'application/pdf'
                    }
                    onChange={handleMediaFileSelected}
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder={`https://… (public link to a sample ${form.header_format})`}
                      value={form.header_media_url}
                      onChange={(e) =>
                        setForm({ ...form, header_media_url: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingMedia}
                      onClick={() => mediaFileRef.current?.click()}
                      className="shrink-0 border-border bg-transparent text-foreground/80 hover:bg-muted"
                    >
                      {uploadingMedia ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      Browse
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Paste a public URL or browse to upload. Meta fetches it once during review — file must stay live for ~24 hrs.
                    {form.header_format === 'image' &&
                      ' Recommended: JPEG or PNG, ≥800×418 px, ≤5 MB.'}
                    {form.header_format === 'video' &&
                      ' Recommended: MP4 / 3GPP, ≤16 MB, ≤60 seconds.'}
                    {form.header_format === 'document' &&
                      ' Recommended: PDF, ≤100 MB.'}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground/80">Body Text</Label>
                <div className="flex items-center gap-1">
                  {/* Formatting toolbar */}
                  <button
                    type="button"
                    title="Bold (*text*)"
                    onClick={() => insertFormatting('*')}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Bold className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Italic (_text_)"
                    onClick={() => insertFormatting('_')}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Italic className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Strikethrough (~text~)"
                    onClick={() => insertFormatting('~')}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Strikethrough className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Monospace (```text```)"
                    onClick={() => insertFormatting('```')}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Code className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Expand editor"
                    onClick={() => setBodyEditorOpen(true)}
                    className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                </div>
              </div>
              <Textarea
                id="template-body-text"
                placeholder="Hello {{1}}, your order {{2}} is confirmed."
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Use {`{{1}}`}, {`{{2}}`} for variables (must be contiguous
                starting at {`{{1}}`}).
              </p>

              {bodyVarCount > 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Sample values (Meta uses these to review your template)
                  </Label>
                  {form.body_samples.map((val, i) => {
                    const inputId = `template-body-sample-${i}`;
                    return (
                      <Input
                        key={i}
                        id={inputId}
                        aria-label={`Sample value for body variable {{${i + 1}}}`}
                        placeholder={`Sample for {{${i + 1}}}`}
                        value={val}
                        onChange={(e) => {
                          const next = [...form.body_samples];
                          next[i] = e.target.value;
                          setForm({ ...form, body_samples: next });
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-foreground/80">Footer (optional)</Label>
              <Input
                placeholder="Optional footer text (max 60 chars)"
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground/80">Buttons (optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addButton}
                  disabled={form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal}
                  className="border-border bg-transparent text-foreground/80 hover:bg-muted h-7 text-xs"
                >
                  <Plus className="size-3" />
                  Add Button
                </Button>
              </div>
              {form.buttons.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Up to {TEMPLATE_LIMITS.maxButtonsTotal} buttons. QUICK_REPLY
                  buttons must come before URL / phone / copy-code buttons.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.buttons.map((btn, i) => (
                    <div
                      key={i}
                      className="space-y-2 rounded border border-border bg-muted/50 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={btn.type}
                          onValueChange={(val) => {
                            // Same null guard as the Header Select
                            // (per PR 148): @base-ui Select fires
                            // onValueChange(null) on deselect.
                            if (!val) return;
                            changeButtonType(i, val as TemplateButton['type']);
                          }}
                        >
                          <SelectTrigger className="w-40 bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-muted border-border">
                            <SelectItem
                              value="QUICK_REPLY"
                              className="text-foreground focus:bg-muted focus:text-foreground"
                            >
                              Quick Reply
                            </SelectItem>
                            <SelectItem
                              value="URL"
                              className="text-foreground focus:bg-muted focus:text-foreground"
                            >
                              URL
                            </SelectItem>
                            <SelectItem
                              value="PHONE_NUMBER"
                              className="text-foreground focus:bg-muted focus:text-foreground"
                            >
                              Phone
                            </SelectItem>
                            <SelectItem
                              value="COPY_CODE"
                              className="text-foreground focus:bg-muted focus:text-foreground"
                            >
                              Copy Code
                            </SelectItem>
                            <SelectItem
                              value="FLOW"
                              className="text-foreground focus:bg-muted focus:text-foreground"
                            >
                              Complete Flow
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="Button label"
                          value={btn.text}
                          maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                          onChange={(e) =>
                            updateButton(i, { text: e.target.value })
                          }
                          className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                      {btn.type === 'URL' && (
                        <div className="space-y-1 pl-1">
                          <Input
                            placeholder="https://example.com/path or with {{1}} suffix"
                            value={btn.url}
                            onChange={(e) =>
                              updateButton(i, { url: e.target.value })
                            }
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                          />
                          {extractVariableIndices(btn.url).length > 0 && (
                            <Input
                              placeholder="Example value for {{1}} (required when URL has a variable)"
                              value={btn.example ?? ''}
                              onChange={(e) =>
                                updateButton(i, { example: e.target.value })
                              }
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          placeholder="+15551234567"
                          value={btn.phone_number}
                          onChange={(e) =>
                            updateButton(i, { phone_number: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'COPY_CODE' && (
                        <Input
                          placeholder="Example code (e.g. SUMMER20)"
                          value={btn.example}
                          onChange={(e) =>
                            updateButton(i, { example: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'FLOW' && (
                        <div className="space-y-1.5 pl-1">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Select flow (published only)</Label>
                            <Select
                              value={btn.flow_id || '__none__'}
                              onValueChange={(val) => {
                                if (!val || val === '__none__') return;
                                const found = metaFlows.find((f) => f.metaFlowId === val);
                                updateButton(i, { flow_id: val, flow_name: found?.name, navigate_screen: '' });
                                // Load screens for the selected flow if not cached
                                if (found && !flowScreens[val]) {
                                  fetch(`/api/flows/${found.dbId}/screens`)
                                    .then((r) => r.json())
                                    .then((d: { screens?: string[] }) => {
                                      if (d.screens?.length) {
                                        setFlowScreens((prev) => ({ ...prev, [val]: d.screens! }));
                                      }
                                    })
                                    .catch(() => {});
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs bg-muted border-border text-foreground">
                                <SelectValue placeholder="Choose a published flow…" />
                              </SelectTrigger>
                              <SelectContent className="bg-muted border-border">
                                {metaFlows.length === 0 && (
                                  <SelectItem value="__none__" disabled className="text-muted-foreground text-xs">
                                    No published flows — sync first
                                  </SelectItem>
                                )}
                                {metaFlows.map((f) => (
                                  <SelectItem
                                    key={f.metaFlowId}
                                    value={f.metaFlowId}
                                    className="text-foreground focus:bg-muted focus:text-foreground text-xs"
                                  >
                                    {f.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={handleSyncFlows}
                              disabled={syncingFlows}
                            >
                              {syncingFlows ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              Sync from Meta
                            </Button>
                          </div>
                          {btn.flow_id && (
                            <>
                              <div>
                                <Label className="text-xs text-muted-foreground mb-1 block">Flow starts with</Label>
                                <Select
                                  value={btn.flow_action === 'data_exchange' ? 'data_exchange' : 'navigate'}
                                  onValueChange={(val) => {
                                    if (!val) return;
                                    if (val === 'data_exchange') {
                                      updateButton(i, { flow_action: 'data_exchange', navigate_screen: '' });
                                    } else {
                                      updateButton(i, { flow_action: 'navigate', navigate_screen: '' });
                                    }
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs bg-muted border-border text-foreground">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-muted border-border">
                                    <SelectItem value="navigate" className="text-foreground focus:bg-muted focus:text-foreground text-xs">
                                      Pre-defined screen
                                    </SelectItem>
                                    <SelectItem value="data_exchange" className="text-foreground focus:bg-muted focus:text-foreground text-xs">
                                      Network request
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {(btn.flow_action ?? 'navigate') === 'navigate' && (
                                <div>
                                  <Label className="text-xs text-muted-foreground mb-1 block">Screen</Label>
                                  {flowScreens[btn.flow_id]?.length ? (
                                    <Select
                                      value={btn.navigate_screen || '__first__'}
                                      onValueChange={(val) => {
                                        if (!val) return;
                                        updateButton(i, { navigate_screen: val === '__first__' ? '' : val });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs bg-muted border-border text-foreground">
                                        <SelectValue placeholder="Select screen…" />
                                      </SelectTrigger>
                                      <SelectContent className="bg-muted border-border">
                                        <SelectItem value="__first__" className="text-muted-foreground text-xs">
                                          — first screen (default) —
                                        </SelectItem>
                                        {flowScreens[btn.flow_id].map((screenId) => (
                                          <SelectItem
                                            key={screenId}
                                            value={screenId}
                                            className="text-foreground focus:bg-muted focus:text-foreground text-xs"
                                          >
                                            {screenId}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      placeholder="Screen name (e.g. WELCOME)"
                                      value={btn.navigate_screen ?? ''}
                                      onChange={(e) =>
                                        updateButton(i, { navigate_screen: e.target.value })
                                      }
                                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                                    />
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="bg-card border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || form.category === 'Authentication'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? 'Saving…' : 'Submitting…'}
                </>
              ) : editingId ? (
                'Save & Resubmit'
              ) : (
                'Submit for Approval'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Body text full-screen editor */}
      <Dialog open={bodyEditorOpen} onOpenChange={setBodyEditorOpen}>
        <DialogContent className="bg-card border-border sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit Body Text</DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Use *bold*, _italic_, ~strikethrough~, ```mono```. Variables: {`{{1}}`} {`{{2}}`}…
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1 border-b border-border pb-2">
            {([['*', 'Bold', Bold], ['_', 'Italic', Italic], ['~', 'Strike', Strikethrough], ['```', 'Mono', Code]] as const).map(([marker, label, Icon]) => (
              <button
                key={marker}
                type="button"
                title={label}
                onClick={() => {
                  const el = document.getElementById('template-body-popup') as HTMLTextAreaElement | null;
                  if (!el) return;
                  const s = el.selectionStart, e2 = el.selectionEnd;
                  const sel = form.body_text.slice(s, e2);
                  const repl = sel ? `${marker}${sel}${marker}` : `${marker}${marker}`;
                  const next = form.body_text.slice(0, s) + repl + form.body_text.slice(e2);
                  setForm((p) => ({ ...p, body_text: next }));
                  requestAnimationFrame(() => {
                    el.focus();
                    const c = s + marker.length + sel.length + marker.length;
                    el.setSelectionRange(c, c);
                  });
                }}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <Textarea
            id="template-body-popup"
            value={form.body_text}
            onChange={(e) => setForm((p) => ({ ...p, body_text: e.target.value }))}
            maxLength={TEMPLATE_LIMITS.bodyMaxLength}
            className="flex-1 min-h-[300px] bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-sm resize-none"
            placeholder="Hello {{1}}, your order {{2}} is confirmed."
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground">
              {form.body_text.length} / {TEMPLATE_LIMITS.bodyMaxLength}
            </span>
            <Button
              onClick={() => setBodyEditorOpen(false)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete template?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? `"${templateToDelete?.name}" will be deleted from Meta and from wacrm. Active broadcasts using this template will start failing on their next send. This can't be undone.`
                : `"${templateToDelete?.name}" will be deleted from wacrm. It was never submitted to Meta, so no remote cleanup is needed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-card border-border">
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="bg-red-600 hover:bg-red-700 text-foreground"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
