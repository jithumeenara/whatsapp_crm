"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  HardDrive, Upload, Trash2, Download, File, Image,
  FileVideo, FileAudio, FileText, Search, AlertTriangle, Loader2,
} from "lucide-react"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface FileItem {
  id: string
  original_name: string
  url: string
  size: number
  mime_type: string
  file_category: string
  created_at: string
}

const CATEGORIES = [
  { key: "all",      label: "All" },
  { key: "image",    label: "Images" },
  { key: "video",    label: "Videos" },
  { key: "audio",    label: "Audio" },
  { key: "pdf",      label: "PDFs" },
  { key: "document", label: "Docs" },
] as const

function FileIcon({ mime, className }: { mime: string; className?: string }) {
  const cls = cn("shrink-0", className)
  if (mime.startsWith("image/"))       return <Image     className={cn(cls, "text-sky-500")} />
  if (mime.startsWith("video/"))       return <FileVideo className={cn(cls, "text-violet-500")} />
  if (mime.startsWith("audio/"))       return <FileAudio className={cn(cls, "text-emerald-500")} />
  if (mime === "application/pdf")      return <FileText  className={cn(cls, "text-rose-500")} />
  return <File className={cn(cls, "text-slate-400")} />
}

function fmtSize(bytes: number) {
  if (bytes < 1024)             return `${bytes} B`
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function FilesPage() {
  const [files,     setFiles]     = useState<FileItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState("")
  const [category,  setCategory]  = useState("all")
  const [uploading, setUploading] = useState(false)
  const [deleteId,  setDeleteId]  = useState<string | null>(null)
  const [deleting,  setDeleting]  = useState(false)
  const [total,     setTotal]     = useState(0)
  const [storage,   setStorage]   = useState(0)
  const didSync = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: "100" })
      if (category !== "all") params.set("category", category)
      if (search)             params.set("search", search)
      const data = await fetch(`/api/file-manager?${params}`).then((r) => r.json())
      setFiles(data.files ?? [])
      setTotal(data.total ?? 0)
      setStorage(data.storage?.used ?? 0)
    } catch { toast.error("Failed to load files") }
    finally { setLoading(false) }
  }, [category, search])

  useEffect(() => {
    if (!didSync.current) {
      // First mount: sync disk files into DB, then load
      didSync.current = true
      fetch("/api/file-manager/sync", { method: "POST" })
        .catch(() => {})
        .finally(() => load())
    } else {
      // Category / search change: just reload
      load()
    }
  }, [load])

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("files", file)
      const res = await fetch("/api/file-manager/upload", { method: "POST", body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Upload failed")
      }
      toast.success("File uploaded")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally { setUploading(false) }
  }

  async function confirmDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/file-manager/${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("File deleted")
      setDeleteId(null)
      load()
    } catch { toast.error("Delete failed") }
    finally { setDeleting(false) }
  }

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">

      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="flex items-center justify-between h-14 gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <HardDrive className="h-3.5 w-3.5" />
            </div>
            <span className="text-[15px] font-semibold text-slate-900">File Manager</span>
            {!loading && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">
                {total}
              </span>
            )}
            {!loading && storage > 0 && (
              <span className="text-[11px] text-slate-400">{fmtSize(storage)} used</span>
            )}
          </div>

          <label className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors cursor-pointer",
            uploading && "opacity-50 cursor-not-allowed pointer-events-none",
          )}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
            <input type="file" className="sr-only" onChange={upload} disabled={uploading} />
          </label>
        </div>

        {/* Category tabs + search */}
        <div className="flex items-center gap-3 pb-3">
          <div className="flex gap-1 flex-1 overflow-x-auto scrollbar-none">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={cn(
                  "shrink-0 h-7 px-3 rounded-lg text-[12px] font-medium transition-colors",
                  category === c.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…"
              className="h-8 w-44 pl-8 pr-3 text-[13px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[180px] rounded-xl bg-white border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
              <HardDrive className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">
              {search || category !== "all" ? "No files found" : "No files yet"}
            </p>
            <p className="mt-1 text-[12px] text-slate-400">
              {search || category !== "all"
                ? "Try a different filter or search"
                : "Upload files to use in messages or store media"}
            </p>
            {(search || category !== "all") && (
              <button
                onClick={() => { setSearch(""); setCategory("all") }}
                className="mt-3 text-[12px] text-indigo-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {files.map((f) => (
              <div
                key={f.id}
                className="group bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden"
              >
                {/* Thumbnail */}
                <div className="relative flex h-32 items-center justify-center bg-slate-50 overflow-hidden">
                  {f.mime_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.url}
                      alt={f.original_name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                    />
                  ) : (
                    <FileIcon mime={f.mime_type} className="h-10 w-10" />
                  )}
                  {/* Hover actions overlay */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 group-hover:bg-black/20 transition-all opacity-0 group-hover:opacity-100">
                    <a
                      href={f.url}
                      download={f.original_name}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-slate-700 hover:bg-white shadow transition-colors"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setDeleteId(f.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-rose-500 hover:bg-white shadow transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Meta */}
                <div className="px-3 py-2 border-t border-slate-50">
                  <p className="text-[12px] font-medium text-slate-800 truncate leading-snug" title={f.original_name}>
                    {f.original_name}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{fmtSize(f.size)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => !deleting && setDeleteId(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-100 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
                <AlertTriangle className="h-4 w-4 text-rose-500" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-slate-900 leading-snug">Delete file?</p>
                <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">
                  This removes the file from disk and the database. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-500 text-[13px] font-medium text-white hover:bg-rose-600 disabled:opacity-50 transition-colors"
              >
                {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
