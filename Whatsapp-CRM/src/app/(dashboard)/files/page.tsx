'use client';

import {
  useState, useEffect, useCallback, useRef, DragEvent,
} from 'react';
import {
  HardDrive, Upload, Search, Trash2, Loader2, FileText,
  FileImage, FileVideo, File, Copy, Check, X, AlertTriangle,
  Shield, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────

interface FileUpload {
  id: string;
  original_name: string;
  url: string;
  mime_type: string;
  size: number;
  file_category: string;
  scan_status: string;
  created_at: string;
}

interface UploadingFile {
  id: string;
  name: string;
  progress: 'uploading' | 'done' | 'error';
  error?: string;
}

interface Storage {
  used: number;
  fileCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'all', label: 'All Files' },
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'document', label: 'Documents' },
  { value: 'video', label: 'Videos' },
  { value: 'other', label: 'Other' },
];

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/3gpp', 'video/quicktime',
  'application/pdf',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
];

const MAX_FILE_SIZE = 16 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('image/')) return <FileImage className={className} />;
  if (mimeType.startsWith('video/')) return <FileVideo className={className} />;
  if (mimeType === 'application/pdf' || mimeType.includes('document') || mimeType.includes('sheet') || mimeType.includes('presentation') || mimeType === 'text/plain' || mimeType === 'text/csv') return <FileText className={className} />;
  return <File className={className} />;
}

function ScanBadge({ status }: { status: string }) {
  if (status === 'clean') return <span title="Scan: Clean"><ShieldCheck className="size-3 text-emerald-500" /></span>;
  if (status === 'infected') return <span title="Scan: Infected"><ShieldAlert className="size-3 text-destructive" /></span>;
  return <span title="Scan: Pending"><Shield className="size-3 text-muted-foreground/50" /></span>;
}

// ─── File Card ───────────────────────────────────────────────

function FileCard({
  file,
  onDelete,
}: {
  file: FileUpload;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isImage = file.mime_type.startsWith('image/');

  const copy = async () => {
    await navigator.clipboard.writeText(window.location.origin + file.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all">
      {/* Preview area */}
      <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img
            src={file.url}
            alt={file.original_name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <FileIcon mimeType={file.mime_type} className="size-10 text-muted-foreground/40" />
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <p className="text-xs font-medium text-foreground truncate" title={file.original_name}>
          {file.original_name}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatBytes(file.size)}</span>
          <ScanBadge status={file.scan_status} />
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={copy}
          title="Copy URL"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80 backdrop-blur text-muted-foreground hover:text-primary hover:bg-background transition-colors border border-border"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onDelete(file.id)}
          title="Delete"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80 backdrop-blur text-muted-foreground hover:text-destructive hover:bg-background transition-colors border border-border"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Infected warning overlay */}
      {file.scan_status === 'infected' && (
        <div className="absolute inset-0 bg-destructive/10 flex items-center justify-center">
          <div className="flex items-center gap-1.5 bg-destructive text-destructive-foreground text-xs font-semibold px-2 py-1 rounded-full">
            <AlertTriangle className="size-3" />
            Infected
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Upload Zone ─────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: (files: FileUpload[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);

  const handleFiles = async (files: File[]) => {
    // Validate
    const validFiles: File[] = [];
    const rejected: { name: string; error: string }[] = [];

    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        rejected.push({ name: f.name, error: 'File type not allowed' });
      } else if (f.size > MAX_FILE_SIZE) {
        rejected.push({ name: f.name, error: 'Exceeds 16 MB limit' });
      } else {
        validFiles.push(f);
      }
    }

    if (validFiles.length === 0) return;

    const pending: UploadingFile[] = validFiles.map((f) => ({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      progress: 'uploading',
    }));
    setUploading(pending);

    try {
      const form = new FormData();
      for (const f of validFiles) form.append('files', f);

      const res = await fetch('/api/file-manager/upload', { method: 'POST', body: form });
      const data = await res.json();

      setUploading((prev) =>
        prev.map((p) => ({ ...p, progress: 'done' as const })),
      );

      if (data.files?.length) onUploaded(data.files);

      // Auto-clear after 2s
      setTimeout(() => setUploading([]), 2000);
    } catch {
      setUploading((prev) =>
        prev.map((p) => ({ ...p, progress: 'error' as const, error: 'Upload failed' })),
      );
      setTimeout(() => setUploading([]), 4000);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-2xl border-2 border-dashed transition-all py-10 flex flex-col items-center justify-center gap-3 cursor-pointer select-none',
          dragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/50 hover:bg-muted/30',
        )}
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Upload className="size-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm text-foreground">
            {dragging ? 'Drop files here' : 'Drag & drop files here'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            or click to browse · Images, PDFs, Documents, Videos · Max 16 MB each
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) handleFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Upload progress */}
      {uploading.length > 0 && (
        <div className="space-y-1.5">
          {uploading.map((f) => (
            <div
              key={f.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                f.progress === 'error'
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : f.progress === 'done'
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                  : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              {f.progress === 'uploading' && <Loader2 className="size-3.5 animate-spin shrink-0" />}
              {f.progress === 'done' && <Check className="size-3.5 shrink-0" />}
              {f.progress === 'error' && <X className="size-3.5 shrink-0" />}
              <span className="truncate">{f.name}</span>
              {f.error && <span className="shrink-0 text-xs">{f.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Storage Bar ─────────────────────────────────────────────

const STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5 GB display limit

function StorageBar({ storage }: { storage: Storage }) {
  const pct = Math.min(100, (storage.used / STORAGE_LIMIT) * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <HardDrive className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-foreground font-medium">Storage Used</span>
          <span className="text-muted-foreground">
            {formatBytes(storage.used)} · {storage.fileCount} files
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', pct > 80 ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

const PAGE_SIZE = 48;

export default function FilesPage() {
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [storage, setStorage] = useState<Storage>({ used: 0, fileCount: 0 });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/file-manager?${params}`);
      const data = await res.json();
      setFiles(data.files ?? []);
      setTotal(data.total ?? 0);
      setStorage(data.storage ?? { used: 0, fileCount: 0 });
    } finally {
      setLoading(false);
    }
  }, [category, page, search]);

  useEffect(() => { load(); }, [load]);

  const onUploaded = (newFiles: FileUpload[]) => {
    setFiles((prev) => [...newFiles, ...prev]);
    setTotal((t) => t + newFiles.length);
    setStorage((s) => ({
      used: s.used + newFiles.reduce((acc, f) => acc + f.size, 0),
      fileCount: s.fileCount + newFiles.length,
    }));
  };

  const doDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await fetch(`/api/file-manager/${deleteId}`, { method: 'DELETE' });
      const deleted = files.find((f) => f.id === deleteId);
      setFiles((prev) => prev.filter((f) => f.id !== deleteId));
      setTotal((t) => t - 1);
      if (deleted) {
        setStorage((s) => ({ used: s.used - deleted.size, fileCount: s.fileCount - 1 }));
      }
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <HardDrive className="size-6 text-primary" />
            File Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and manage images, PDFs, documents, and videos.
          </p>
        </div>
      </div>

      {/* Storage bar */}
      <StorageBar storage={storage} />

      {/* Upload zone */}
      <UploadZone onUploaded={onUploaded} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => { setCategory(c.value); setPage(1); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                category === c.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <span className="text-xs text-muted-foreground ml-auto">{total} files</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 gap-3 text-muted-foreground">
          <Upload className="size-10 opacity-20" />
          <p className="text-sm">{search || category !== 'all' ? 'No files match your filter.' : 'No files uploaded yet. Drag & drop above to get started.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {files.map((f) => (
            <FileCard key={f.id} file={f} onDelete={setDeleteId} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete File"
        description="This file will be permanently deleted from storage. This action cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={doDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
