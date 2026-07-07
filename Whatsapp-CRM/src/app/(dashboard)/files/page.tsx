"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { HardDrive, Upload, Trash2, Download, File, Image, FileVideo, FileAudio, Search } from "lucide-react"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface FileItem { id: string; name: string; url: string; size: number; content_type: string; created_at: string }

function fileIcon(ct: string) {
  if (ct.startsWith("image/")) return <Image className="h-5 w-5 text-sky-500" />
  if (ct.startsWith("video/")) return <FileVideo className="h-5 w-5 text-violet-500" />
  if (ct.startsWith("audio/")) return <FileAudio className="h-5 w-5 text-emerald-500" />
  return <File className="h-5 w-5 text-slate-400" />
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function FilesV2() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [uploading, setUploading] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await fetch("/api/file-manager").then((r) => r.json())
      setFiles(Array.isArray(data) ? data : (data?.files ?? []))
    } catch { toast.error("Failed to load files") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData(); fd.append("file", file)
      await fetch("/api/upload", { method: "POST", body: fd })
      toast.success("Uploaded!"); load()
    } catch { toast.error("Upload failed") }
    finally { setUploading(false); e.target.value = "" }
  }

  async function del(id: string) {
    try {
      await fetch(`/api/files/${id}`, { method: "DELETE" })
      toast.success("Deleted"); setDeleteId(null); load()
    } catch { toast.error("Failed") }
  }

  const filtered = files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
              <HardDrive className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">File Manager</h1>
              <p className="text-[11px] text-slate-500">{files.length} file{files.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <label className={cn("flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors cursor-pointer", uploading && "opacity-50 cursor-not-allowed")}>
            <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload"}
            <input type="file" className="sr-only" onChange={upload} disabled={uploading} />
          </label>
        </div>
        <div className="mt-3 relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none" placeholder="Search files…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-[100px] animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4"><HardDrive className="h-7 w-7 text-slate-400" /></div>
            <p className="text-[14px] font-semibold text-slate-700">{search ? "No files found" : "No files yet"}</p>
            <p className="mt-1 text-[12px] text-slate-400">{search ? "Try a different search" : "Upload media files to use in messages"}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {filtered.map((f) => (
              <div key={f.id} className="group bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-4 flex flex-col gap-3">
                {f.content_type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} className="w-full h-28 object-cover rounded-lg bg-slate-100" />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg bg-slate-50">
                    {fileIcon(f.content_type)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800 truncate">{f.name}</p>
                  <p className="text-[11px] text-slate-400">{fmtSize(f.size)}</p>
                </div>
                <div className="flex gap-1">
                  <a href={f.url} download={f.name} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button type="button" onClick={() => setDeleteId(f.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-2">Delete File?</h2>
            <p className="text-[13px] text-slate-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => del(deleteId)} className="flex-1 rounded-lg bg-rose-600 py-2 text-[13px] font-medium text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
