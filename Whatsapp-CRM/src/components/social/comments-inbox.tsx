"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { EyeOff, Eye, Trash2, Send, MessageCircle, Check, RotateCcw, ExternalLink, Loader2, MessagesSquare, Sparkles, AtSign, UserPlus, MessageSquareOff } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole, isAccountRole } from "@/lib/auth/roles"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"

interface CommentItem {
  id: string
  channel: "instagram" | "facebook"
  kind: "comment" | "mention"
  is_reply: boolean
  post_caption: string | null
  post_link: string | null
  from_name: string | null
  contact_id: string | null
  text: string | null
  commented_at: string
  is_hidden: boolean
  status: "open" | "done"
  private_replied: boolean
  can_private_reply: boolean
  replies: Array<{ text: string; at: string | null }>
}

type StatusFilter = "open" | "done" | "all"
type ChannelFilter = "" | "instagram" | "facebook"

const CHANNEL_LABEL = { instagram: "Instagram", facebook: "Facebook" } as const

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function CommentsInbox() {
  const { accountRole } = useAuth()
  // Exact role flags would hide these from an owner: compare ranks instead.
  const canModerate = Boolean(accountRole && isAccountRole(accountRole) && hasMinRole(accountRole, "supervisor"))
  const canReply = Boolean(accountRole && isAccountRole(accountRole) && hasMinRole(accountRole, "agent"))

  const [status, setStatus] = useState<StatusFilter>("open")
  const [channel, setChannel] = useState<ChannelFilter>("")
  const [items, setItems] = useState<CommentItem[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const loadSeq = useRef(0)

  const load = useCallback(async (opts: { more?: boolean; quiet?: boolean } = {}) => {
    const seq = ++loadSeq.current
    if (!opts.quiet && !opts.more) setLoading(true)
    try {
      const q = new URLSearchParams({ status })
      if (channel) q.set("channel", channel)
      if (opts.more && nextBefore) q.set("before", nextBefore)
      const body = (await (await apiFetch(`/api/social/comments?${q}`)).json()) as { comments?: CommentItem[]; next_before?: string | null }
      if (seq !== loadSeq.current) return
      const list = Array.isArray(body.comments) ? body.comments : []
      setItems((prev) => (opts.more ? [...prev, ...list.filter((c) => !prev.some((p) => p.id === c.id))] : list))
      setNextBefore(body.next_before ?? null)
      setFailed(false)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[comments] load failed:", err)
      if (!opts.quiet) { setFailed(true); toast.error(errorText(err, "Could not load comments.")) }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [status, channel, nextBefore])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  // Reload when a filter changes; refresh quietly every 30 s while visible.
  useEffect(() => { void loadRef.current() }, [status, channel])
  useEffect(() => everyWhileVisible(() => { void loadRef.current({ quiet: true }) }, 30_000), [])

  const refresh = useCallback(() => { void loadRef.current({ quiet: true }) }, [])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Comments</h1>
          <p className="mt-0.5 text-sm text-slate-500">Comments on your Instagram and Facebook posts. Reply, send a private message, or hide.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="tablist" aria-label="Show" className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["open", "done", "all"] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${status === s ? "bg-primary text-primary-foreground" : "text-slate-600 hover:bg-slate-50"}`}>
                {s === "open" ? "To answer" : s === "done" ? "Done" : "All"}
              </button>
            ))}
          </div>
          <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as ChannelFilter)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
            <option value="">All channels</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </select>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div>
        ) : failed ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Could not load comments. <button type="button" className="font-semibold text-slate-900 underline" onClick={() => void load()}>Try again</button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare className="h-6 w-6" aria-hidden />}
            title={status === "open" ? "No comments to answer" : "No comments here"}
            description="New comments on your connected Instagram account and Facebook Page appear here. Meta must have approved comment access for your app."
          />
        ) : (
          items.map((c) => <CommentCard key={c.id} c={c} canReply={canReply} canModerate={canModerate} onChanged={refresh} />)
        )}
        {!loading && nextBefore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={() => void load({ more: true })}>Load older</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function CommentCard({ c, canReply, canModerate, onChanged }: { c: CommentItem; canReply: boolean; canModerate: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "reply" | "private">(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCommentsOff, setConfirmCommentsOff] = useState(false)
  const router = useRouter()
  const max = mode === "private" ? (c.channel === "instagram" ? 1000 : 2000) : 2200

  async function act(key: string, url: string, init: RequestInit, done: string) {
    if (busy) return
    setBusy(key)
    try {
      const res = await apiFetch(url, init)
      const body = (await res.json().catch(() => ({}))) as { conversation_id?: string | null }
      toast.success(done, body.conversation_id ? { action: { label: "Open chat", onClick: () => router.push(`/inbox?conversation=${encodeURIComponent(body.conversation_id!)}`) } } : undefined)
      setMode(null)
      setText("")
      onChanged()
    } catch (err) {
      console.error(`[comments] ${key} failed:`, err)
      toast.error(errorText(err, "That did not work. Try again."))
    } finally {
      setBusy(null)
    }
  }

  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

  // A suggestion only fills the box: a person reads and sends it.
  async function suggest() {
    if (busy || !mode) return
    setBusy("suggest")
    try {
      const res = await apiFetch(`/api/social/comments/${c.id}/suggest`, json({ mode: mode === "private" ? "private" : "public" }))
      const body = (await res.json()) as { draft?: unknown; warnings?: unknown }
      if (typeof body.draft === "string") setText(body.draft.slice(0, max))
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === "string") : []
      if (warnings.length) toast.warning(warnings.join(" "))
    } catch (err) {
      console.error("[comments] suggest failed:", err)
      toast.error(errorText(err, "Could not suggest a reply."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className={`rounded-xl border bg-white p-4 shadow-sm ${c.is_hidden ? "border-amber-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
        <span className={`rounded-full px-2 py-0.5 font-medium ${c.channel === "instagram" ? "bg-pink-50 text-pink-700" : "bg-blue-50 text-blue-700"}`}>{CHANNEL_LABEL[c.channel]}</span>
        <span>{when(c.commented_at)}</span>
        {c.kind === "mention" && <span className="inline-flex items-center gap-0.5 font-medium text-violet-700"><AtSign className="h-3 w-3" aria-hidden /> mentioned you</span>}
        {c.is_reply && <span>· reply in a thread</span>}
        {c.is_hidden && <span className="font-medium text-amber-700">· hidden</span>}
        {c.private_replied && <span className="font-medium text-emerald-700">· private reply sent</span>}
      </div>

      {(c.post_caption || c.post_link) && (
        <p className="mt-2 line-clamp-2 break-words text-[12px] text-slate-500">
          {c.kind === "mention" ? "Their post" : "On post"}: {c.post_caption ?? "(no caption)"}{" "}
          {c.post_link && (
            <a href={c.post_link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 font-medium text-slate-700 underline">
              open <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </p>
      )}

      <p className="mt-2 text-[13px] font-semibold text-slate-800">
        {c.contact_id ? <Link href={`/contacts?open=${encodeURIComponent(c.contact_id)}`} className="hover:underline">{c.from_name ?? "Someone"}</Link> : (c.from_name ?? "Someone")}
      </p>
      {/* Plain text only — never rendered as HTML. */}
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] text-slate-700">{c.text ?? ""}</p>

      {c.replies.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-slate-100 pl-3">
          {c.replies.map((r, i) => (
            <li key={i} className="whitespace-pre-wrap break-words text-[13px] text-slate-600"><span className="font-medium text-slate-700">You: </span>{r.text}</li>
          ))}
        </ul>
      )}

      {mode && (
        <div className="mt-3">
          <label className="sr-only" htmlFor={`reply-${c.id}`}>{mode === "private" ? "Private message" : "Public reply"}</label>
          <textarea id={`reply-${c.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={max} rows={3} autoComplete="off"
            placeholder={mode === "private" ? "A private message to this person…" : "Your public reply…"}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300" />
          {mode === "private" && <p className="mt-1 text-[11px] text-slate-500">Meta allows one private message per comment, within 7 days. Their answer continues in the Inbox.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={!text.trim() || busy !== null}
              onClick={() => void act(mode, `/api/social/comments/${c.id}/${mode === "private" ? "private-reply" : "reply"}`, json({ text }), mode === "private" ? "Private message sent." : "Reply posted.")}>
              {busy === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
              {mode === "private" ? "Send privately" : "Post reply"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void suggest()}>
              {busy === "suggest" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              Suggest
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setMode(null); setText("") }}>Cancel</Button>
          </div>
        </div>
      )}

      {!mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canReply && <Button size="sm" variant="outline" onClick={() => setMode("reply")}><MessageCircle className="h-3.5 w-3.5" aria-hidden /> Reply</Button>}
          {canReply && c.can_private_reply && <Button size="sm" variant="outline" onClick={() => setMode("private")}><Send className="h-3.5 w-3.5" aria-hidden /> Private reply</Button>}
          {canReply && (
            <Button size="sm" variant="ghost" disabled={busy !== null}
              onClick={() => void act("status", `/api/social/comments/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: c.status === "done" ? "open" : "done" }) }, c.status === "done" ? "Moved back to answer." : "Marked done.")}>
              {c.status === "done" ? <><RotateCcw className="h-3.5 w-3.5" aria-hidden /> To answer</> : <><Check className="h-3.5 w-3.5" aria-hidden /> Done</>}
            </Button>
          )}
          {canReply && c.contact_id && (
            <Button size="sm" variant="ghost" disabled={busy !== null}
              onClick={() => void act("lead", `/api/social/comments/${c.id}/lead`, { method: "POST" }, "Lead created in the lead pool.")}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden /> Make lead
            </Button>
          )}
          {canModerate && c.kind === "comment" && c.channel === "instagram" && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmCommentsOff(true)}>
              <MessageSquareOff className="h-3.5 w-3.5" aria-hidden /> Comments off
            </Button>
          )}
          {canModerate && c.kind === "comment" && (
            <Button size="sm" variant="ghost" disabled={busy !== null}
              onClick={() => void act("hide", `/api/social/comments/${c.id}/hide`, json({ hidden: !c.is_hidden }), c.is_hidden ? "Comment shown again." : "Comment hidden.")}>
              {c.is_hidden ? <><Eye className="h-3.5 w-3.5" aria-hidden /> Show</> : <><EyeOff className="h-3.5 w-3.5" aria-hidden /> Hide</>}
            </Button>
          )}
          {canModerate && c.kind === "comment" && (
            <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmCommentsOff}
        title="Turn off comments on this post?"
        description="Nobody can add new comments to this Instagram post until you turn them on again in Instagram."
        confirmLabel="Turn off"
        onCancel={() => setConfirmCommentsOff(false)}
        onConfirm={() => { setConfirmCommentsOff(false); void act("comments-off", `/api/social/comments/${c.id}/post-comments`, json({ enabled: false }), "Comments turned off on this post.") }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this comment?"
        description={`It is removed from ${CHANNEL_LABEL[c.channel]} for everyone. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); void act("delete", `/api/social/comments/${c.id}`, { method: "DELETE" }, "Comment deleted.") }}
      />
    </article>
  )
}
