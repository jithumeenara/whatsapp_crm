"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ImagePlus, Loader2, Send, CalendarClock, X, Ban } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"

type Channel = "instagram" | "facebook"
type PostType = "feed" | "reel" | "story"
interface Media { link: string; kind: "image" | "video"; name: string }
interface PostItem {
  id: string
  channels: Channel[]
  post_type: PostType
  caption: string | null
  media: Array<{ link: string; kind: "image" | "video" }>
  status: "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled"
  scheduled_at: string
  published_at: string | null
  outcome: Record<string, string>
}

const MAX_FILE = 16 * 1024 * 1024
const STATUS_TEXT: Record<PostItem["status"], string> = {
  scheduled: "Scheduled", publishing: "Publishing…", published: "Published", partial: "Partly published", failed: "Failed", cancelled: "Cancelled",
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/** Compose and schedule Instagram / Facebook posts; see what went out. */
export function PublishTab() {
  const [channels, setChannels] = useState<Channel[]>(["instagram"])
  const [postType, setPostType] = useState<PostType>("feed")
  const [caption, setCaption] = useState("")
  const [media, setMedia] = useState<Media[]>([])
  const [scheduleAt, setScheduleAt] = useState("") // datetime-local, browser time
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const keyRef = useRef(newKey())

  const [posts, setPosts] = useState<PostItem[]>([])
  const [loading, setLoading] = useState(true)
  const loadSeq = useRef(0)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const load = useCallback(async (quiet = false) => {
    const seq = ++loadSeq.current
    try {
      const body = (await (await apiFetch("/api/social/posts")).json()) as { posts?: PostItem[] }
      if (seq !== loadSeq.current) return
      setPosts(Array.isArray(body.posts) ? body.posts : [])
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[publish] load failed:", err)
      if (!quiet) toast.error(errorText(err, "Could not load posts."))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => everyWhileVisible(() => { void load(true) }, 30_000), [load])

  async function addFiles(files: FileList | null) {
    if (!files?.length || uploading) return
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, 10 - media.length)) {
        if (file.size > MAX_FILE) { toast.error(`${file.name} is larger than 16 MB.`); continue }
        if (!/^(image\/(jpeg|png)|video\/(mp4|quicktime))$/.test(file.type)) { toast.error(`${file.name}: use JPEG or PNG pictures, MP4 or MOV videos.`); continue }
        const form = new FormData()
        form.append("file", file)
        const res = await apiFetch("/api/upload", { method: "POST", body: form })
        const body = (await res.json()) as { url?: unknown }
        if (typeof body.url !== "string") throw new Error("Upload failed")
        setMedia((m) => [...m, { link: body.url as string, kind: file.type.startsWith("video/") ? "video" : "image", name: file.name }])
      }
    } catch (err) {
      console.error("[publish] upload failed:", err)
      toast.error(errorText(err, "Could not upload the file."))
    } finally {
      setUploading(false)
    }
  }

  async function submit(schedule: boolean) {
    if (sending) return
    if (schedule && !scheduleAt) { toast.error("Choose a date and time."); return }
    setSending(true)
    try {
      await apiFetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_key: keyRef.current,
          channels,
          post_type: postType,
          caption,
          media: media.map((m) => m.link),
          // The browser's own time, sent with its offset.
          ...(schedule ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        }),
      })
      toast.success(schedule ? "Post scheduled." : "Publishing now — it appears below.")
      keyRef.current = newKey()
      setCaption(""); setMedia([]); setScheduleAt("")
      void load(true)
    } catch (err) {
      console.error("[publish] send failed:", err)
      toast.error(errorText(err, "Could not create the post."))
    } finally {
      setSending(false)
    }
  }

  async function cancel(id: string) {
    try {
      await apiFetch(`/api/social/posts/${id}`, { method: "DELETE" })
      toast.success("Post cancelled.")
      void load(true)
    } catch (err) {
      console.error("[publish] cancel failed:", err)
      toast.error(errorText(err, "Could not cancel the post."))
    }
  }

  const toggle = (ch: Channel) => setChannels((c) => (c.includes(ch) ? c.filter((x) => x !== ch) : [...c, ch]))
  const captionMax = channels.includes("instagram") ? 2200 : 63000

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <section aria-labelledby="compose" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h2 id="compose" className="text-[15px] font-semibold text-slate-800">New post</h2>

        <fieldset className="mt-3 flex flex-wrap gap-4">
          <legend className="sr-only">Post to</legend>
          {(["instagram", "facebook"] as const).map((ch) => (
            <label key={ch} className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggle(ch)} className="h-4 w-4 rounded border-slate-300" />
              {ch === "instagram" ? "Instagram" : "Facebook Page"}
            </label>
          ))}
          <label className="ml-auto flex items-center gap-2 text-[13px] text-slate-700">
            Type
            <select value={postType} onChange={(e) => setPostType(e.target.value as PostType)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px]">
              <option value="feed">Post</option>
              <option value="reel">Reel (one video)</option>
              <option value="story">Story (Instagram)</option>
            </select>
          </label>
        </fieldset>

        <label className="mt-4 block">
          <span className="text-[12.5px] font-medium text-slate-600">Caption <span className="font-normal text-slate-400">({[...caption].length}/{captionMax})</span></span>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={captionMax} rows={4} autoComplete="off"
            placeholder="Write your caption…"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300" />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {media.map((m, i) => (
            <span key={m.link} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-[12px] text-slate-700">
              <span className="truncate" title={m.name}>{m.kind === "video" ? "🎬" : "🖼"} {m.name}</span>
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-200">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          {media.length < 10 && (
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[12.5px] text-slate-600 hover:bg-slate-50 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
              {uploading ? "Uploading…" : "Add picture or video"}
              <input type="file" multiple accept="image/jpeg,image/png,video/mp4,video/quicktime" className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = "" }} />
            </label>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Instagram accepts JPEG pictures; up to 10 items, 16 MB each.</p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Button disabled={sending || uploading || channels.length === 0} onClick={() => void submit(false)}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Publish now
          </Button>
          <label className="flex flex-col text-[12px] text-slate-600">
            <span>Or schedule for</span>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-[13px]" />
          </label>
          <Button variant="outline" disabled={sending || uploading || channels.length === 0 || !scheduleAt} onClick={() => void submit(true)}>
            <CalendarClock className="h-4 w-4" aria-hidden /> Schedule
          </Button>
        </div>
      </section>

      <section aria-labelledby="posts" className="space-y-3">
        <h2 id="posts" className="text-[15px] font-semibold text-slate-800">Scheduled and recent posts</h2>
        {loading ? (
          <div className="flex justify-center py-10 text-slate-400" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div>
        ) : posts.length === 0 ? (
          <EmptyState title="No posts yet" description="Posts you publish or schedule from here appear in this list." />
        ) : (
          posts.map((p) => (
            <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
                <span className="font-medium text-slate-700">{STATUS_TEXT[p.status] ?? p.status}</span>
                <span>· {p.status === "scheduled" ? `for ${when(p.scheduled_at)}` : when(p.published_at ?? p.scheduled_at)}</span>
                <span>· {p.channels.map((c) => (c === "instagram" ? "Instagram" : "Facebook")).join(" + ")}</span>
                <span>· {p.post_type === "feed" ? "post" : p.post_type}{p.media.length ? `, ${p.media.length} item${p.media.length > 1 ? "s" : ""}` : ""}</span>
              </div>
              {p.caption && <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-[13.5px] text-slate-700">{p.caption}</p>}
              {Object.entries(p.outcome).filter(([, v]) => v !== "published" && v !== "pending").map(([ch, v]) => (
                <p key={ch} className="mt-1 text-[12px] text-rose-700">{ch === "instagram" ? "Instagram" : "Facebook"}: {v}</p>
              ))}
              {p.status === "scheduled" && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setCancelId(p.id)}><Ban className="h-3.5 w-3.5" aria-hidden /> Cancel</Button>
              )}
            </article>
          ))
        )}
      </section>

      <ConfirmDialog
        open={cancelId !== null}
        title="Cancel this scheduled post?"
        description="It will not be published. You can create it again later."
        confirmLabel="Cancel post"
        cancelLabel="Keep it"
        variant="destructive"
        onCancel={() => setCancelId(null)}
        onConfirm={() => { const id = cancelId; setCancelId(null); if (id) void cancel(id) }}
      />
    </div>
  )
}
