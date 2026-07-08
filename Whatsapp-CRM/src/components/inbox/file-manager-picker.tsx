"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X, Search, Loader2, File, FileText, FileVideo, FileAudio, Image,
  FolderOpen, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FileItem {
  id: string;
  original_name: string;
  url: string;
  mime_type: string;
  size: number;
  file_category: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (file: FileItem) => void;
}

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "pdf", label: "PDFs" },
  { key: "document", label: "Docs" },
] as const;

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ mime, category, className }: { mime: string; category: string; className?: string }) {
  const cls = cn("shrink-0", className);
  if (category === "image") return <Image className={cn(cls, "text-sky-500")} />;
  if (category === "video") return <FileVideo className={cn(cls, "text-violet-500")} />;
  if (category === "audio") return <FileAudio className={cn(cls, "text-emerald-500")} />;
  if (category === "pdf") return <FileText className={cn(cls, "text-rose-500")} />;
  return <File className={cn(cls, "text-slate-400")} />;
}

export function FileManagerPicker({ open, onClose, onSelect }: Props) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "60" });
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`/api/file-manager?${params}`);
      const data = await res.json();
      setFiles(data.files ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => {
    if (open) { load(); setSelected(null); }
  }, [open, load]);

  if (!open) return null;

  const handleSelect = (file: FileItem) => {
    setSelected(file.id);
    // small delay so user sees selection before close
    setTimeout(() => {
      onSelect(file);
      onClose();
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
            <FolderOpen className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-slate-900">File Manager</p>
            <p className="text-[11px] text-slate-400">Select a file to send</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
          {/* Category tabs */}
          <div className="flex gap-1 flex-1 overflow-x-auto scrollbar-none">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={cn(
                  "shrink-0 h-7 px-3 rounded-lg text-[12px] font-medium transition-colors",
                  category === c.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search…"
              className="h-7 w-36 pl-8 pr-3 text-[12px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:border-indigo-400 transition-colors"
            />
          </div>
        </div>

        {/* File grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <FolderOpen className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-[13px] font-medium text-slate-500">No files found</p>
              <p className="text-[11px] mt-0.5">Upload files via the attachment button or File Manager</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {files.map((file) => {
                const isImage = file.file_category === "image";
                const isSelected = selected === file.id;
                return (
                  <button
                    key={file.id}
                    onClick={() => handleSelect(file)}
                    className={cn(
                      "group relative flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all",
                      isSelected
                        ? "border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.2)]"
                        : "border-slate-100 hover:border-indigo-300 hover:shadow-md"
                    )}
                  >
                    {/* Thumbnail / icon */}
                    <div className="relative aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                      {isImage ? (
                        <img
                          src={file.url}
                          alt={file.original_name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <FileIcon mime={file.mime_type} category={file.file_category} className="h-8 w-8" />
                      )}
                      {/* Selected tick */}
                      {isSelected && (
                        <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600">
                            <Check className="h-4 w-4 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Label */}
                    <div className="px-2 py-1.5 bg-white">
                      <p className="text-[11px] font-medium text-slate-700 truncate leading-snug">
                        {file.original_name}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{fmtSize(file.size)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-400 text-center">
          Tap a file to send it instantly · To upload new files, use the device option or visit File Manager
        </div>
      </div>
    </div>
  );
}
