'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { ArrowRight, ArrowLeft, FileText, Search, Loader2, Globe, Image as ImageIcon, Film, File as FileIcon, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

const MEDIA_ACCEPT: Record<string, string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MEDIA_ICON: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Film, document: FileIcon };

const CAT_STYLES: Record<string, { badge: string; dot: string }> = {
  Marketing:      { badge: 'bg-violet-50 text-violet-700 border-violet-200',  dot: 'bg-violet-400' },
  Utility:        { badge: 'bg-sky-50 text-sky-700 border-sky-200',           dot: 'bg-sky-400' },
  Authentication: { badge: 'bg-amber-50 text-amber-700 border-amber-200',     dot: 'bg-amber-400' },
};
const DEFAULT_CAT = { badge: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' };

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
  /** Campaign-level override for a media-header template's image/video/document. */
  headerMediaUrl: string;
  onHeaderMediaChange: (url: string) => void;
}

export function Step1ChooseTemplate({ selectedTemplate, onSelect, onNext, onBack, headerMediaUrl, onHeaderMediaChange }: Step1Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaType = selectedTemplate?.header_type as string | undefined;
  const needsMedia = mediaType === 'image' || mediaType === 'video' || mediaType === 'document';
  const MediaIcon = needsMedia ? MEDIA_ICON[mediaType!] : null;

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

  useEffect(() => {
    fetch('/api/whatsapp/templates?status=APPROVED', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : r.json().then((b: { error?: string }) => Promise.reject(b?.error ?? `HTTP ${r.status}`)))
      .then((j) => setTemplates(j.templates ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = templates.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.body_text ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Choose a Template</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">Select an approved WhatsApp template for your broadcast.</p>
      </div>

      {/* Top nav — mirrors the bottom bar so you don't have to scroll past
          the template grid / media picker just to move to the next step. */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <Button variant="outline" onClick={onBack} className="border-slate-200 text-slate-700 h-9">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!selectedTemplate}
          className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      {!loading && !error && templates.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex h-52 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            <p className="text-[13px] text-slate-400">Loading templates…</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 gap-2">
          <p className="text-[13px] font-medium text-rose-600">Failed to load templates</p>
          <p className="text-[12px] text-rose-400 max-w-xs text-center">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <FileText className="h-6 w-6 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-medium text-slate-700">
              {search ? 'No templates match' : 'No approved templates'}
            </p>
            <p className="text-[12px] text-slate-400 mt-0.5">
              {search ? 'Try a different search.' : 'Create and submit templates for approval in Meta Business Manager.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((t) => {
            const isSelected = selectedTemplate?.id === t.id;
            const cat = CAT_STYLES[t.category] ?? DEFAULT_CAT;
            return (
              <button key={t.id} type="button" onClick={() => onSelect(t)}
                className={cn(
                  'group flex flex-col gap-3 rounded-xl border p-4 text-left transition-all',
                  isSelected
                    ? 'border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-200 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-sm'
                )}>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isSelected && (
                      <div className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600">
                        <svg viewBox="0 0 10 8" className="h-2.5 w-2.5">
                          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </div>
                    )}
                    <p className={cn('text-[13px] font-semibold truncate', isSelected ? 'text-indigo-800' : 'text-slate-800')}>
                      {t.name}
                    </p>
                  </div>
                  <span className={cn('shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', cat.badge)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', cat.dot)} />
                    {t.category}
                  </span>
                </div>

                {/* Body preview */}
                <p className="line-clamp-3 text-[12px] text-slate-500 leading-relaxed">
                  {t.body_text || <span className="italic text-slate-300">No preview available</span>}
                </p>

                {/* Footer */}
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Globe className="h-3 w-3" />
                  {t.language ?? 'en_US'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Media picker — only shown once a template with an IMAGE/VIDEO/DOCUMENT
          header is selected. Optional: leave blank to reuse the template's own
          approved sample media on every send. */}
      {needsMedia && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            {MediaIcon && <MediaIcon className="h-4 w-4 text-indigo-600" />}
            <p className="text-[13px] font-semibold text-indigo-800">
              {mediaType === 'image' ? 'Header image' : mediaType === 'video' ? 'Header video' : 'Header document'} for this campaign
            </p>
          </div>
          <p className="text-[11px] text-indigo-500 mb-3">
            Optional — pick media for this specific broadcast, or leave blank to reuse the template&apos;s approved sample media.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT[mediaType!]}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); e.target.value = ''; }}
          />

          {headerMediaUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-white p-2.5">
              {mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerMediaUrl} alt="Header media" className="h-12 w-12 rounded-md object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-indigo-50">
                  {MediaIcon && <MediaIcon className="h-5 w-5 text-indigo-500" />}
                </div>
              )}
              <p className="flex-1 truncate text-[12px] text-slate-600">{headerMediaUrl.split('/').pop()}</p>
              <button type="button" onClick={() => onHeaderMediaChange('')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex h-20 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-200 bg-white text-[12px] font-medium text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Click to upload'}
            </button>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} className="border-slate-200 text-slate-700 h-9">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!selectedTemplate}
          className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
