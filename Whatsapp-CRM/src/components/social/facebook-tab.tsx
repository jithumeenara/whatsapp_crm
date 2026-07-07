"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { MessageCircle, Share2, Eye, TrendingUp, Users, MousePointer, X, ExternalLink, RefreshCw, ThumbsUp } from "lucide-react"
import { io, type Socket } from "socket.io-client"
import { useAuth } from "@/hooks/use-auth"

interface FbPage {
  id: string
  name: string
  about?: string
  bio?: string
  fan_count?: number
  followers_count?: number
  picture?: { data: { url: string } }
  cover?: { source: string }
}

interface Reaction {
  id: string
  name: string
  pic_large?: string
  type: "LIKE" | "LOVE" | "HAHA" | "WOW" | "SAD" | "ANGRY"
}

interface FbPost {
  id: string
  message?: string
  created_time: string
  full_picture?: string
  likes: number
  comments: number
  shares: number
  reach: number
  impressions: number
  engaged_users: number
  clicks: number
  reactions: Reaction[]
}

const REACTION_EMOJI: Record<string, string> = {
  LIKE: "👍", LOVE: "❤️", HAHA: "😂", WOW: "😮", SAD: "😢", ANGRY: "😡",
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + "K"
  return String(n)
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (d > 30) return new Date(ts).toLocaleDateString()
  if (d > 0)  return `${d}d ago`
  if (h > 0)  return `${h}h ago`
  return `${m}m ago`
}

export function FacebookTab() {
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [page, setPage]                 = useState<FbPage | null>(null)
  const [posts, setPosts]               = useState<FbPost[]>([])
  const [selected, setSelected]         = useState<FbPost | null>(null)
  const [permRequired, setPermRequired] = useState(false)
  const [postsError, setPostsError]     = useState<string | null>(null)
  const { accountId } = useAuth()
  const socketRef = useRef<Socket | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPermRequired(false)
    setPostsError(null)
    try {
      const res  = await fetch("/api/social/facebook")
      const data = await res.json() as { page?: FbPage; posts?: FbPost[]; error?: string; permission_required?: boolean; posts_error?: string }
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setPage(data.page ?? null)
      setPosts(data.posts ?? [])
      setPermRequired(data.permission_required ?? false)
      setPostsError(data.posts_error ?? null)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Listen for real-time feed updates (new likes/comments) via socket
  useEffect(() => {
    if (!accountId) return
    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] })
    socketRef.current = socket

    const handleJoin = () => socket.emit("join_account", accountId)
    if (socket.connected) handleJoin()
    socket.on("connect", handleJoin)
    socket.on("facebook_feed_update", () => { void load() })

    return () => {
      socket.off("connect", handleJoin)
      socket.off("facebook_feed_update")
      socket.disconnect()
    }
  }, [accountId, load])

  if (loading) return <FacebookSkeleton />

  if (error) return (
    <div className="flex flex-col items-center justify-center h-80 gap-3">
      <div className="h-12 w-12 rounded-full bg-rose-50 flex items-center justify-center">
        <X className="h-6 w-6 text-rose-500" />
      </div>
      <p className="text-[14px] text-slate-600 font-medium">{error}</p>
      <p className="text-[12px] text-slate-400">Make sure your Facebook Page is connected in Settings</p>
      <button onClick={load} className="mt-1 flex items-center gap-1.5 text-[12px] text-indigo-600 font-medium hover:underline">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  )

  if (!page) return null

  // When pages_read_engagement is missing, show the page name + setup instructions
  if (permRequired) {
    return (
      <div className="p-6 space-y-5">
        {/* Page name card — basic info always available */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0 shadow-md">
            <span className="text-2xl font-bold text-white">{(page.name as string)?.[0] ?? "F"}</span>
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-slate-900">{page.name as string}</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Page ID: {page.id as string}</p>
          </div>
          <a
            href={`https://facebook.com/${page.id as string}`}
            target="_blank" rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#1877F2] hover:bg-[#1565C0] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open Page
          </a>
        </div>

        {/* Permission setup banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-lg">🔑</span>
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-amber-900">
                pages_read_engagement permission required
              </h3>
              <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
                To show page analytics and posts, your Meta app needs the <strong>pages_read_engagement</strong> permission.
                Your Messenger messaging still works — only the analytics view is limited.
              </p>
            </div>
          </div>

          <div className="bg-white/70 rounded-xl border border-amber-200 p-4 space-y-3">
            <p className="text-[12px] font-bold text-amber-900 uppercase tracking-wide">How to fix</p>
            <ol className="space-y-2 text-[13px] text-amber-800">
              <li className="flex gap-2">
                <span className="shrink-0 font-bold text-amber-600">1.</span>
                Go to <strong>Meta Developers Console</strong> → your app → <strong>App Review → Permissions and Features</strong>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-bold text-amber-600">2.</span>
                Find <strong>pages_read_engagement</strong> → click <strong>Request Advanced Access</strong> (or Add for Development)
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-bold text-amber-600">3.</span>
                If your app is in <strong>Development mode</strong>: the permission activates immediately for you as app admin
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-bold text-amber-600">4.</span>
                Regenerate your <strong>Page Access Token</strong> from Messenger → API Settings → Access Tokens (so it includes the new permission)
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-bold text-amber-600">5.</span>
                Update the token in <strong>Settings → Facebook</strong>, then click Retry below
              </li>
            </ol>
          </div>

          <button
            onClick={load}
            className="flex items-center gap-1.5 text-[13px] font-medium text-amber-700 hover:text-amber-900"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry after updating token
          </button>
        </div>
      </div>
    )
  }

  const totalReach       = posts.reduce((s, p) => s + p.reach,       0)
  const totalImpressions = posts.reduce((s, p) => s + p.impressions, 0)
  const totalLikes       = posts.reduce((s, p) => s + p.likes,       0)
  const totalEngaged     = posts.reduce((s, p) => s + p.engaged_users, 0)

  const coverUrl = page.cover?.source

  return (
    <div className="p-6 space-y-6">

      {/* Page profile card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="cover" className="h-24 w-full object-cover" />
        ) : (
          <div className="h-24 bg-gradient-to-r from-[#1877F2] to-[#42a5f5]" />
        )}
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-10 mb-4">
            <div className="relative">
              {page.picture?.data?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={page.picture.data.url}
                  alt={page.name}
                  className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-md"
                />
              ) : (
                <div className="h-20 w-20 rounded-full border-4 border-white bg-[#1877F2] flex items-center justify-center shadow-md">
                  <span className="text-2xl font-bold text-white">{page.name[0]}</span>
                </div>
              )}
            </div>
            <div className="pb-2 flex-1">
              <h2 className="text-[17px] font-bold text-slate-900">{page.name}</h2>
              {(page.about ?? page.bio) && (
                <p className="text-[12px] text-slate-600 mt-0.5 line-clamp-2">{page.about ?? page.bio}</p>
              )}
            </div>
            <a
              href={`https://facebook.com/${page.id}`}
              target="_blank" rel="noreferrer"
              className="flex-none mb-2 flex items-center gap-1.5 rounded-lg bg-[#1877F2] hover:bg-[#1565C0] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open Page
            </a>
          </div>

          <div className="grid grid-cols-2 divide-x divide-slate-100 rounded-xl bg-slate-50 border border-slate-100">
            {[
              { label: "Followers", value: formatNum(page.followers_count ?? 0), icon: Users },
              { label: "Page Fans",  value: formatNum(page.fan_count ?? 0),      icon: ThumbsUp },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex flex-col items-center py-3 gap-0.5">
                <Icon className="h-4 w-4 text-slate-400 mb-0.5" />
                <span className="text-[15px] font-bold text-slate-900">{value}</span>
                <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analytics overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Reach",       value: formatNum(totalReach),       icon: Eye,         color: "text-blue-600",   bg: "bg-blue-50" },
          { label: "Total Impressions", value: formatNum(totalImpressions),  icon: TrendingUp,  color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Total Likes",       value: formatNum(totalLikes),        icon: ThumbsUp,    color: "text-[#1877F2]",  bg: "bg-blue-50" },
          { label: "Engaged Users",     value: formatNum(totalEngaged),      icon: Users,       color: "text-green-600",  bg: "bg-green-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`h-4.5 w-4.5 ${color}`} />
            </div>
            <div>
              <p className="text-[17px] font-bold text-slate-900 leading-tight">{value}</p>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Posts list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-bold text-slate-800">Recent Posts</h3>
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        <div className="space-y-3">
          {posts.map((post) => (
            <FbPostCard key={post.id} post={post} onClick={() => setSelected(post)} />
          ))}
          {posts.length === 0 && !postsError && (
            <p className="text-center text-[13px] text-slate-400 py-12">No posts found</p>
          )}
          {postsError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
              <span className="font-semibold">Could not load posts: </span>{postsError}
              <span className="block mt-1 text-amber-600">
                Add <strong>pages_read_user_content</strong> in Meta Developer Console → Permissions and Features, then regenerate your Page Access Token.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && <FbPostDetailPanel post={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function FbPostCard({ post, onClick }: { post: FbPost; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#1877F2]/30 transition-all p-4 flex gap-4"
    >
      {post.full_picture && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.full_picture}
          alt=""
          className="h-20 w-20 rounded-lg object-cover shrink-0 border border-slate-100"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-slate-700 line-clamp-2 leading-relaxed">
          {post.message ?? <span className="text-slate-400 italic">No caption</span>}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">{timeAgo(post.created_time)}</p>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1 text-[12px] text-slate-500"><ThumbsUp className="h-3.5 w-3.5 text-[#1877F2]" />{formatNum(post.likes)}</span>
          <span className="flex items-center gap-1 text-[12px] text-slate-500"><MessageCircle className="h-3.5 w-3.5 text-slate-400" />{formatNum(post.comments)}</span>
          <span className="flex items-center gap-1 text-[12px] text-slate-500"><Share2 className="h-3.5 w-3.5 text-slate-400" />{formatNum(post.shares)}</span>
          <span className="flex items-center gap-1 text-[12px] text-slate-500"><Eye className="h-3.5 w-3.5 text-slate-400" />{formatNum(post.reach)}</span>
        </div>
      </div>
    </button>
  )
}

function FbPostDetailPanel({ post, onClose }: { post: FbPost; onClose: () => void }) {
  // Group reactions by type
  const reactionGroups = post.reactions.reduce<Record<string, Reaction[]>>((acc, r) => {
    acc[r.type] = [...(acc[r.type] ?? []), r]
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 h-7 w-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
          <X className="h-4 w-4 text-slate-600" />
        </button>

        {/* Image */}
        {post.full_picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.full_picture} alt="" className="w-full max-h-72 object-cover rounded-t-2xl" />
        )}

        <div className="p-6 space-y-5">
          {/* Caption */}
          <div>
            <p className="text-[13px] text-slate-700 leading-relaxed">{post.message ?? <span className="text-slate-400 italic">No caption</span>}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-slate-400">{timeAgo(post.created_time)}</span>
              <a
                href={`https://facebook.com/${post.id}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-[#1877F2] font-medium hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View on Facebook
              </a>
            </div>
          </div>

          {/* Engagement */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Engagement</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Likes",         value: post.likes,        icon: ThumbsUp,      color: "text-[#1877F2]", bg: "bg-blue-50" },
                { label: "Comments",      value: post.comments,     icon: MessageCircle, color: "text-slate-600",  bg: "bg-slate-50" },
                { label: "Shares",        value: post.shares,       icon: Share2,        color: "text-green-600",  bg: "bg-green-50" },
                { label: "Clicks",        value: post.clicks,       icon: MousePointer,  color: "text-amber-600",  bg: "bg-amber-50" },
                { label: "Reach",         value: post.reach,        icon: Eye,           color: "text-blue-600",   bg: "bg-blue-50" },
                { label: "Engaged Users", value: post.engaged_users, icon: Users,         color: "text-purple-600", bg: "bg-purple-50" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`flex items-center gap-2.5 rounded-lg ${bg} px-3 py-2.5`}>
                  <Icon className={`h-4 w-4 ${color} shrink-0`} />
                  <div>
                    <p className="text-[14px] font-bold text-slate-900">{formatNum(value)}</p>
                    <p className="text-[10px] text-slate-500">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reactions breakdown */}
          {post.reactions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                Reactions — {post.reactions.length} people
              </p>
              {/* Reaction type summary */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(reactionGroups).map(([type, arr]) => (
                  <span key={type} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700">
                    {REACTION_EMOJI[type] ?? "👍"} {arr.length}
                  </span>
                ))}
              </div>
              {/* Who reacted list */}
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-xl border border-slate-100 p-3">
                {post.reactions.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    {r.pic_large ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.pic_large} alt={r.name} className="h-7 w-7 rounded-full object-cover border border-slate-200" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-500 shrink-0">
                        {r.name[0]}
                      </div>
                    )}
                    <span className="text-[12px] text-slate-700 font-medium flex-1">{r.name}</span>
                    <span className="text-[14px]">{REACTION_EMOJI[r.type] ?? "👍"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FacebookSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="bg-white rounded-2xl border border-slate-100 h-48" />
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl h-20 border border-slate-100" />)}
      </div>
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl h-24 border border-slate-100" />)}
      </div>
    </div>
  )
}
