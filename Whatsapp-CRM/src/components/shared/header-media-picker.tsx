'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, Upload, X, Search,
  Image as ImageIcon, Film, File as FileIcon,
} from 'lucide-react';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

const MEDIA_ACCEPT: Record<string, string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MEDIA_ICON: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Film, document: FileIcon };

interface FileManagerItem {
  id: string;
  original_name: string;
  url: string;
  mime_type: string;
  file_category: string;
}

export interface HeaderMediaPickerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Which Meta header type this media is for — drives the accept filter,
   *  icon, and which File Manager categories count as a match. */
  mediaType: 'image' | 'video' | 'document';
  headerMediaUrl: string;
  onHeaderMediaChange: (url: string) => void;
  /** Whether the send would fail without media (no default sample to fall
   *  back on) — drives the amber "Required" styling and copy. */
  required?: boolean;
}

/**
 * Shared by both the Broadcast Personalize step and the Inbox/Lead
 * TemplatePicker: pick a template header's image/video/document either by
 * uploading a new file or browsing the account's existing File Manager.
 * Originally built once for broadcasts only, then needed again verbatim
 * for one-off template sends — extracted here so both stay in sync
 * instead of drifting as two separate copies.
 */
export function HeaderMediaPicker({
  open,
  onOpenChange,
  mediaType,
  headerMediaUrl,
  onHeaderMediaChange,
  required,
}: HeaderMediaPickerProps) {
  const [uploading, setUploading] = useState(false);
  const [mediaSource, setMediaSource] = useState<'upload' | 'library'>('upload');
  const [libraryFiles, setLibraryFiles] = useState<FileManagerItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MediaIcon = MEDIA_ICON[mediaType];

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

  // Browse already-uploaded files instead of uploading a new one. The File
  // Manager API only filters by one category at a time, so "document"
  // (Meta's header type) fetches "all" and filters client-side against
  // both "document" and "pdf" — File Manager files a PDF separately.
  useEffect(() => {
    if (!open || mediaSource !== 'library') return;
    setLoadingLibrary(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ category: 'all', pageSize: '60' });
      if (librarySearch.trim()) params.set('search', librarySearch.trim());
      fetch(`/api/file-manager?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const accept = mediaType === 'document' ? new Set(['document', 'pdf']) : new Set([mediaType]);
          const files = ((j?.files ?? []) as FileManagerItem[]).filter((f) => accept.has(f.file_category));
          setLibraryFiles(files);
        })
        .catch(() => {})
        .finally(() => setLoadingLibrary(false));
    }, 300);
    return () => clearTimeout(t);
  }, [open, mediaSource, mediaType, librarySearch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-md">
        <DialogHeader className={cn('bg-gradient-to-br px-6 pb-5 pt-6', required ? 'from-amber-50 to-white' : 'from-indigo-50 to-white')}>
          <div className={cn('mb-1 flex h-11 w-11 items-center justify-center rounded-2xl', required ? 'bg-amber-100' : 'bg-indigo-100')}>
            <MediaIcon className={cn('h-5 w-5', required ? 'text-amber-600' : 'text-indigo-600')} />
          </div>
          <DialogTitle className="text-[17px] font-bold text-slate-800">
            {mediaType === 'image' ? 'Header Image' : mediaType === 'video' ? 'Header Video' : 'Header Document'}
          </DialogTitle>
          <p className="mt-0.5 text-[12px] text-slate-400">
            {required
              ? 'This template has no default media Meta can reuse at send time — attach one or the send will fail.'
              : "Optional — attach media for this send, or leave blank to reuse the template's approved sample media."}
          </p>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-6 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT[mediaType]}
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
                  <MediaIcon className="h-6 w-6 text-indigo-500" />
                </div>
              )}
              <p className="flex-1 truncate text-[12.5px] text-slate-600">{headerMediaUrl.split('/').pop()}</p>
              <button type="button" onClick={() => onHeaderMediaChange('')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              {/* Upload a new file, or pick one already sitting in File Manager */}
              <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
                <button type="button" onClick={() => setMediaSource('upload')}
                  className={cn('flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-all', mediaSource === 'upload' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  Upload New
                </button>
                <button type="button" onClick={() => setMediaSource('library')}
                  className={cn('flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-all', mediaSource === 'library' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  File Manager
                </button>
              </div>

              {mediaSource === 'upload' ? (
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className={cn('flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-white text-[12.5px] font-medium disabled:opacity-50',
                    required ? 'border-amber-300 text-amber-600 hover:border-amber-400 hover:bg-amber-50/50' : 'border-indigo-200 text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/50')}>
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                  {uploading ? 'Uploading…' : 'Click to upload'}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                      placeholder="Search File Manager…"
                      className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[12px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  {loadingLibrary ? (
                    <div className="flex h-28 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                    </div>
                  ) : libraryFiles.length === 0 ? (
                    <p className="py-8 text-center text-[12px] text-slate-400">
                      No matching {mediaType} files in your File Manager yet.
                    </p>
                  ) : mediaType === 'image' ? (
                    <div className="grid max-h-60 grid-cols-4 gap-2 overflow-y-auto pr-1">
                      {libraryFiles.map((f) => (
                        <button key={f.id} type="button" onClick={() => { onHeaderMediaChange(f.url); setMediaSource('upload'); }}
                          title={f.original_name}
                          className="aspect-square overflow-hidden rounded-lg border border-slate-200 hover:border-indigo-400">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.original_name} className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                      {libraryFiles.map((f) => (
                        <button key={f.id} type="button" onClick={() => { onHeaderMediaChange(f.url); setMediaSource('upload'); }}
                          className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 p-2 text-left hover:border-indigo-400 hover:bg-indigo-50/30">
                          <MediaIcon className="h-4 w-4 shrink-0 text-indigo-500" />
                          <span className="truncate text-[12px] text-slate-700">{f.original_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <Button onClick={() => onOpenChange(false)} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
