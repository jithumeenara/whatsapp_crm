'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, MessageSquare, Link2, StickyNote, Database, Plus, Search, Filter,
  Loader2, RefreshCw, Trash2, MoreHorizontal, CheckCircle2, AlertTriangle, Clock,
  EyeOff, ChevronLeft, ChevronRight, Upload, X, Sparkles,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AiButton, AiCard, AiCardHeader, AiIconTile, AiBadge, AiInput, AiTextarea, AiLabel, AiHint, AiNotice,
  AiMenu, AiMenuTrigger, AiMenuContent, AiMenuItem, AiMenuSeparator,
  AiModal, AiModalHeader, AiModalBody, AiModalFooter,
} from './ui-kit';

/**
 * Screen 4 — the knowledge base, backed by real rows
 * (ai_knowledge_items) rather than the two JSON blobs this used to be.
 *
 * Five ways in (type a Q&A pair, upload a document, sync a web page,
 * paste notes, connect a Data Store table), one table out, and the
 * retrieval settings that decide how any of it reaches a reply.
 */

export interface KnowledgeItem {
  id: string;
  kind: 'qa' | 'document' | 'website' | 'text' | 'database';
  name: string;
  source: string;
  question: string | null;
  answer: string | null;
  source_url: string | null;
  source_ref: string | null;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingTabProps {
  knowledgeBaseEnabled: boolean;
  onKnowledgeBaseEnabledChange: (v: boolean) => void;
  retrievalMode: string;
  onRetrievalModeChange: (v: string) => void;
  maxContextResults: number;
  onMaxContextResultsChange: (v: number) => void;
  autoSyncWebsite: boolean;
  onAutoSyncWebsiteChange: (v: boolean) => void;
  semanticSearchAvailable: boolean;
  /** Persists the settings above (the page's shared save). */
  onSaveSettings: () => Promise<boolean>;
  savingSettings: boolean;
}

type AddKind = 'qa' | 'document' | 'website' | 'text' | 'database';

const SOURCE_CARDS: Array<{ kind: AddKind; label: string; blurb: string; Icon: typeof FileText; tint: string }> = [
  { kind: 'document', label: 'Documents', blurb: 'Upload files, PDFs, policies, etc.', Icon: FileText, tint: 'bg-[#EEF0FF] text-[#5B6CF9]' },
  { kind: 'qa', label: 'Q&A Pairs', blurb: 'Add common questions and answers.', Icon: MessageSquare, tint: 'bg-emerald-50 text-emerald-600' },
  { kind: 'website', label: 'Website', blurb: 'Sync from your website URLs.', Icon: Link2, tint: 'bg-violet-50 text-violet-600' },
  { kind: 'text', label: 'Text / Notes', blurb: 'Add custom instructions and context.', Icon: StickyNote, tint: 'bg-amber-50 text-amber-600' },
  { kind: 'database', label: 'Database', blurb: 'Connect to your data (optional).', Icon: Database, tint: 'bg-rose-50 text-rose-600' },
];

const KIND_LABEL: Record<string, string> = {
  qa: 'Q&A',
  document: 'Document',
  website: 'Website',
  text: 'Text',
  database: 'Database',
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual Entry',
  upload: 'Manual Upload',
  web_sync: 'Web Sync',
  data_store: 'Data Store',
  test_feedback: 'Saved from Test AI',
};

const PAGE_SIZE = 8;

function StatusPill({ status, error }: { status: string; error: string | null }) {
  if (status === 'trained') {
    return (
      <AiBadge tone="emerald">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Trained
      </AiBadge>
    );
  }
  if (status === 'failed') {
    return (
      <span title={error ?? undefined}>
        <AiBadge tone="rose">
          <AlertTriangle className="h-3.5 w-3.5" />
          Failed
        </AiBadge>
      </span>
    );
  }
  if (status === 'disabled') {
    return (
      <AiBadge tone="slate">
        <EyeOff className="h-3.5 w-3.5" />
        Disabled
      </AiBadge>
    );
  }
  return (
    <AiBadge tone="amber">
      <Clock className="h-3.5 w-3.5" />
      Not trained
    </AiBadge>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function TrainingTab(props: TrainingTabProps) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query.trim()) params.set('q', query.trim());
      if (kindFilter) params.set('kind', kindFilter);
      const res = await fetch(`/api/ai-knowledge?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load the knowledge base.');
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load the knowledge base.');
    } finally {
      setLoading(false);
    }
  }, [page, query, kindFilter]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per
    // keystroke; filter/page changes go through the same path.
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const untrained = useMemo(() => items.filter((i) => i.status === 'pending' || i.status === 'failed').length, [items]);

  async function runTraining() {
    setTraining(true);
    setTrainResult('');
    try {
      const res = await fetch('/api/ai-knowledge/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Training failed.');
      const bits = [`${data.embedded} embedded`];
      if (data.deleted) bits.push(`${data.deleted} removed`);
      if (data.failed) bits.push(`${data.failed} failed`);
      setTrainResult(bits.join(' · '));
      await load();
    } catch (err) {
      setTrainResult(err instanceof Error ? err.message : 'Training failed.');
    } finally {
      setTraining(false);
    }
  }

  async function updateItem(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/ai-knowledge/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setListError(data.error ?? 'Update failed.');
    await load();
  }

  async function deleteItem(id: string) {
    await fetch(`/api/ai-knowledge/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        {/* ── Sources ── */}
        <AiCard className="p-6">
          <AiCardHeader
            title={<span className="text-[16px] tracking-[-0.015em]">AI Training</span>}
            subtitle="Add your business knowledge so AI gives accurate and relevant answers."
            action={
              <AiButton onClick={runTraining} disabled={training}>
                {training ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Train now
              </AiButton>
            }
          />

          {trainResult && <AiNotice tone="info" className="mt-3">{trainResult}</AiNotice>}
          {untrained > 0 && !training && (
            <AiNotice tone="warning" icon={<Clock className="h-3.5 w-3.5" />} className="mt-3">
              {untrained} {untrained === 1 ? 'entry is' : 'entries are'} saved but not embedded yet — they&apos;re still
              used by keyword matching, and &ldquo;Train now&rdquo; makes them searchable by meaning.
            </AiNotice>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {SOURCE_CARDS.map(({ kind, label, blurb, Icon, tint }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setAddKind(kind)}
                className="group flex flex-col rounded-2xl bg-white p-3.5 text-left ring-1 ring-slate-200/70 transition-all duration-150 hover:-translate-y-0.5 hover:ring-[#5B6CF9]/35 hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)] motion-safe:active:translate-y-0"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ring-white/0 ${tint}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="mt-2.5 text-[12.5px] font-semibold text-slate-800">{label}</span>
                <span className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{blurb}</span>
              </button>
            ))}
          </div>
        </AiCard>

        {/* ── Knowledge base table ── */}
        <AiCard>
          <div className="p-6 pb-4">
            <AiCardHeader
              title="Knowledge Base"
              subtitle="Manage the information used by your AI assistant."
              action={
                <AiMenu>
                  <AiMenuTrigger className="inline-flex h-9 select-none items-center gap-2 rounded-xl bg-gradient-to-b from-[#6B7BFF] to-[#5B6CF9] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_6px_16px_-6px_rgba(91,108,249,0.65)] outline-none transition-all duration-150 hover:from-[#5F70FB] hover:to-[#4E5FEE] focus-visible:ring-2 focus-visible:ring-[#5B6CF9]/35 focus-visible:ring-offset-2 motion-safe:active:translate-y-px">
                    <Plus className="h-4 w-4" />
                    Add Content
                  </AiMenuTrigger>
                  <AiMenuContent>
                    {SOURCE_CARDS.map(({ kind, label, blurb, Icon }) => (
                      <AiMenuItem
                        key={kind}
                        onClick={() => setAddKind(kind)}
                        icon={<Icon className="h-4 w-4" />}
                        title={label}
                        description={blurb}
                      />
                    ))}
                  </AiMenuContent>
                </AiMenu>
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <AiInput
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                placeholder="Search content…"
                className="h-9 pl-9"
              />
            </div>
            <Select value={kindFilter || 'all'} onValueChange={(v) => { setKindFilter(!v || v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl border-slate-200 text-[13px]">
                <span className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {listError && <AiNotice tone="error" className="mx-6 mb-4">{listError}</AiNotice>}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-y border-slate-100 bg-slate-50/70 text-left">
                  {['Name', 'Type', 'Source', 'Updated', 'Status', ''].map((h) => (
                    <th key={h} className="px-6 py-2.5 text-[11.5px] font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#5B6CF9]" />
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-[13px] text-slate-500">
                      {query || kindFilter ? 'Nothing matches that.' : 'No knowledge added yet — start with one of the five sources above.'}
                    </td>
                  </tr>
                )}
                {!loading && items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60">
                    <td className="max-w-[260px] px-6 py-3">
                      <p className="truncate text-[13px] font-medium text-slate-800" title={item.name}>{item.name}</p>
                      {item.source_url && (
                        <p className="truncate text-[11px] text-slate-400" title={item.source_url}>{item.source_url}</p>
                      )}
                      {item.status === 'failed' && item.last_error && (
                        <p className="truncate text-[11px] text-rose-500" title={item.last_error}>{item.last_error}</p>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">
                        {KIND_LABEL[item.kind] ?? item.kind}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[12.5px] text-slate-500">{SOURCE_LABEL[item.source] ?? item.source}</td>
                    <td className="px-6 py-3 text-[12.5px] text-slate-500">{formatDate(item.last_synced_at ?? item.updated_at)}</td>
                    <td className="px-6 py-3"><StatusPill status={item.status} error={item.last_error} /></td>
                    <td className="px-6 py-3 text-right">
                      <AiMenu>
                        <AiMenuTrigger
                          aria-label="Entry actions"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-[#5B6CF9]/35 data-[popup-open]:bg-slate-100 data-[popup-open]:text-slate-700"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </AiMenuTrigger>
                        <AiMenuContent className="min-w-[200px]">
                          {(item.kind === 'website' || item.kind === 'database') && (
                            <AiMenuItem
                              onClick={() => updateItem(item.id, { resync: true })}
                              icon={<RefreshCw className="h-4 w-4" />}
                              title="Re-sync now"
                              description="Fetch the latest content"
                            />
                          )}
                          <AiMenuItem
                            onClick={() => updateItem(item.id, { status: item.status === 'disabled' ? 'pending' : 'disabled' })}
                            icon={<EyeOff className="h-4 w-4" />}
                            title={item.status === 'disabled' ? 'Re-enable' : 'Disable'}
                            description={item.status === 'disabled' ? 'Use it in replies again' : 'Keep it, stop using it'}
                          />
                          <AiMenuSeparator />
                          <AiMenuItem
                            onClick={() => deleteItem(item.id)}
                            icon={<Trash2 className="h-4 w-4" />}
                            title="Delete"
                            tone="danger"
                          />
                        </AiMenuContent>
                      </AiMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-4">
            <p className="text-[12px] text-slate-500">
              {total === 0 ? 'No entries' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
            <div className="flex items-center gap-1">
              <AiButton
                tone="outline" size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="w-8 px-0"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </AiButton>
              <span className="px-2 text-[12.5px] font-medium tabular-nums text-slate-700">{page} / {totalPages}</span>
              <AiButton
                tone="outline" size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="w-8 px-0"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </AiButton>
            </div>
          </div>
        </AiCard>
      </div>

      {/* ── Settings rail ── */}
      <div className="space-y-5">
        <AiCard className="p-5">
          <AiCardHeader title="Training Settings" subtitle="Control how your data is used by the AI." />

          <div className="mt-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-slate-700">Use knowledge base</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">AI will search your data before answering.</p>
              </div>
              <Switch checked={props.knowledgeBaseEnabled} onCheckedChange={props.onKnowledgeBaseEnabledChange} />
            </div>

            <div className="space-y-1.5">
              <AiLabel>Retrieval mode</AiLabel>
              <Select value={props.retrievalMode} onValueChange={(v) => v && props.onRetrievalModeChange(v)}>
                <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Semantic Search (Recommended)</SelectItem>
                  <SelectItem value="semantic">Semantic only</SelectItem>
                  <SelectItem value="keyword">Keyword matching</SelectItem>
                </SelectContent>
              </Select>
              <AiHint>
                {props.semanticSearchAvailable
                  ? 'Finds the most relevant information using meaning, not just shared words.'
                  : 'Semantic search needs a Gemini key — keyword matching is used until one is saved.'}
              </AiHint>
            </div>

            <div className="space-y-1.5">
              <AiLabel>Max context results</AiLabel>
              <Select
                value={String(props.maxContextResults)}
                onValueChange={(v) => v && props.onMaxContextResultsChange(Number(v))}
              >
                <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 8, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AiHint>Number of relevant chunks to include in the prompt.</AiHint>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-slate-700">Auto-sync website</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">Re-fetch website entries daily.</p>
              </div>
              <Switch checked={props.autoSyncWebsite} onCheckedChange={props.onAutoSyncWebsiteChange} />
            </div>

            <AiButton
              onClick={props.onSaveSettings}
              disabled={props.savingSettings}
              tone="outline"
              className="w-full"
            >
              {props.savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save training settings
            </AiButton>
          </div>
        </AiCard>
      </div>

      {addKind && (
        <AddContentDialog
          kind={addKind}
          onClose={() => setAddKind(null)}
          onAdded={() => { setAddKind(null); setPage(1); load(); }}
        />
      )}
    </div>
  );
}

/** One dialog, five shapes — each source needs different inputs but the
 *  same create/close/refresh cycle. */
function AddContentDialog({ kind, onClose, onAdded }: { kind: AddKind; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [tableId, setTableId] = useState('');
  const [tables, setTables] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (kind !== 'database') return;
    fetch('/api/data-tables')
      .then((r) => (r.ok ? r.json() : { tables: [] }))
      .then((d) => setTables(d.tables ?? d ?? []))
      .catch(() => {});
  }, [kind]);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (kind === 'document') {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error('Choose a file first.');
        const form = new FormData();
        form.append('file', file);
        if (name.trim()) form.append('name', name.trim());
        const res = await fetch('/api/ai-knowledge/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      } else {
        const res = await fetch('/api/ai-knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            name: name.trim() || undefined,
            question: question.trim() || undefined,
            answer: answer.trim() || undefined,
            content: content.trim() || undefined,
            source_url: url.trim() || undefined,
            source_ref: tableId || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not add that.');
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  }

  const title = SOURCE_CARDS.find((c) => c.kind === kind)?.label ?? 'Add content';

  const card = SOURCE_CARDS.find((c) => c.kind === kind);

  return (
    <AiModal open onOpenChange={(v) => !v && onClose()} size="sm">
      <div>
        <AiModalHeader
          icon={
            card ? (
              <AiIconTile size="lg" className={card.tint}>
                <card.Icon className="h-5 w-5" />
              </AiIconTile>
            ) : undefined
          }
          title={title}
          subtitle={
            kind === 'document' ? 'Upload a PDF or text file — its text is extracted and stored.'
            : kind === 'qa' ? 'A question a customer might ask, and the answer the bot should give.'
            : kind === 'website' ? 'The page is fetched once now, and can be re-synced any time.'
            : kind === 'text' ? 'Paste notes, policies or instructions in your own words.'
            : 'Pick a Data Store table — its records become searchable knowledge.'
          }
          onClose={onClose}
        />

        <AiModalBody className="space-y-4">
          {kind === 'qa' && (
            <>
              <div className="space-y-1.5">
                <AiLabel>Question</AiLabel>
                <AiInput
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What are your working hours?"
                />
              </div>
              <div className="space-y-1.5">
                <AiLabel>Answer</AiLabel>
                <AiTextarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={4}
                  placeholder="We're open 9am to 6pm, Monday to Saturday."
                />
              </div>
            </>
          )}

          {kind === 'document' && (
            <>
              <div className="space-y-1.5">
                <AiLabel>File</AiLabel>
                <input
                  autoComplete="off"
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,.html"
                  className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-[12.5px] text-slate-600 ring-1 ring-slate-200/90 transition-shadow hover:ring-slate-300 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#EEF0FF] file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-[#5B6CF9]"
                />
                <AiHint>PDF, TXT, MD, CSV, JSON or HTML, up to 10MB. Scanned PDFs have no readable text.</AiHint>
              </div>
              <div className="space-y-1.5">
                <AiLabel>Name (optional)</AiLabel>
                <AiInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Defaults to the file name"
                />
              </div>
            </>
          )}

          {kind === 'website' && (
            <div className="space-y-1.5">
              <AiLabel>Page URL</AiLabel>
              <AiInput
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.example.com/admissions"
                className="font-mono"
              />
              <AiHint>Pages built entirely by JavaScript may return no readable text.</AiHint>
            </div>
          )}

          {kind === 'text' && (
            <>
              <div className="space-y-1.5">
                <AiLabel>Title</AiLabel>
                <AiInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Refund policy" />
              </div>
              <div className="space-y-1.5">
                <AiLabel>Content</AiLabel>
                <AiTextarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  placeholder="Paste the details the AI should know…"
                />
              </div>
            </>
          )}

          {kind === 'database' && (
            <div className="space-y-1.5">
              <AiLabel>Data Store table</AiLabel>
              <Select value={tableId} onValueChange={(v) => v && setTableId(v)}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                  <SelectValue placeholder={tables.length ? 'Choose a table' : 'No tables found'} />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AiHint>
                Records are read once now and whenever you re-sync — up to 500 rows. Password-type fields are never
                included.
              </AiHint>
            </div>
          )}

          {error && (
            <AiNotice tone="error" icon={<X className="h-3.5 w-3.5" />}>{error}</AiNotice>
          )}
        </AiModalBody>

        <AiModalFooter className="justify-end">
          <AiButton tone="outline" onClick={onClose}>Cancel</AiButton>
          <AiButton onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : kind === 'document' ? <Upload className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Add
          </AiButton>
        </AiModalFooter>
      </div>
    </AiModal>
  );
}
