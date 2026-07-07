"use client"

import { useEffect, useState } from "react"
import {
  Heart, MessageCircle, Bookmark, Eye, TrendingUp, Users,
  Play, X, ExternalLink, RefreshCw, Grid3X3, Film, Image as ImageLucide,
  Layers, LayoutGrid,
} from "lucide-react"

interface IgProfile {
  id: string
  username: string
  name: string
  biography?: string
  followers_count: number
  follows_count: number
  media_count: number
  profile_picture_url?: string
  website?: string
}

interface IgMedia {
  id: string
  caption?: string
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_url?: string
  thumbnail_url?: string
  permalink: string
  timestamp: string
  like_count: number
  comments_count: number
  shares: number
  reach: number
  saved: number
  video_views: number
  total_interactions: number
}

type FilterType = "ALL" | "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"

function n(v: number) {
  if (!v) return "0"
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M"
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + "K"
  return v.toLocaleString()
}

function ago(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const d = Math.floor(diff / 86400000)
  if (d > 365) return Math.floor(d / 365) + "y ago"
  if (d > 30)  return Math.floor(d / 30)  + "mo ago"
  if (d > 0)   return d + "d ago"
  const h = Math.floor(diff / 3600000)
  if (h > 0)   return h + "h ago"
  return Math.floor(diff / 60000) + "m ago"
}

export function InstagramTab() {
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [profile, setProfile]   = useState<IgProfile | null>(null)
  const [media, setMedia]       = useState<IgMedia[]>([])
  const [filter, setFilter]     = useState<FilterType>("ALL")
  const [selected, setSelected] = useState<IgMedia | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch("/api/social/instagram")
      const data = await res.json() as { profile?: IgProfile; media?: IgMedia[]; error?: string }
      if (!res.ok) { setError(data.error ?? "Failed to load"); return }
      setProfile(data.profile ?? null)
      setMedia(data.media ?? [])
    } catch { setError("Network error") }
    finally   { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filtered = filter === "ALL" ? media : media.filter(m => m.media_type === filter)

  const totalLikes    = media.reduce((s, m) => s + m.like_count,     0)
  const totalComments = media.reduce((s, m) => s + m.comments_count, 0)
  const totalReach    = media.reduce((s, m) => s + m.reach,          0)
  const totalSaved    = media.reduce((s, m) => s + m.saved,          0)
  const totalShares   = media.reduce((s, m) => s + m.shares,         0)
  const reels            = media.filter(m => m.media_type === "VIDEO")
  const photos           = media.filter(m => m.media_type === "IMAGE")
  const carousels        = media.filter(m => m.media_type === "CAROUSEL_ALBUM")

  if (loading) return <Skeleton />

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="h-14 w-14 rounded-full bg-rose-50 flex items-center justify-center">
        <X className="h-7 w-7 text-rose-400" />
      </div>
      <p className="text-[15px] font-semibold text-slate-700">{error}</p>
      <p className="text-[12px] text-slate-400 text-center max-w-xs">Make sure your Instagram Business account is connected in Settings and the access token is valid.</p>
      <button onClick={load} className="mt-2 flex items-center gap-2 rounded-lg bg-slate-100 hover:bg-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 transition-colors">
        <RefreshCw className="h-3.5 w-3.5" /> Try again
      </button>
    </div>
  )

  if (!profile) return null

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

      {/* ── Profile card ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Banner */}
        <div className="h-[100px] bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045]" />

        <div className="px-6 pb-5">
          {/* Avatar row */}
          <div className="flex items-start justify-between gap-4 -mt-[42px] mb-4">
            {/* Avatar */}
            <div className="shrink-0">
              {profile.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.profile_picture_url}
                  alt={profile.username}
                  className="h-[84px] w-[84px] rounded-full border-4 border-white object-cover shadow-lg"
                />
              ) : (
                <div className="h-[84px] w-[84px] rounded-full border-4 border-white bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shadow-lg">
                  <span className="text-3xl font-bold text-white">{profile.username[0].toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Open Profile button */}
            <a
              href={`https://instagram.com/${profile.username}`}
              target="_blank" rel="noreferrer"
              className="mt-[48px] flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open on Instagram
            </a>
          </div>

          {/* Name / bio */}
          <div className="mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[18px] font-bold text-slate-900">{profile.name}</h2>
              <span className="text-[13px] text-slate-400 font-medium">@{profile.username}</span>
            </div>
            {profile.biography && (
              <p className="text-[13px] text-slate-600 mt-1 leading-relaxed whitespace-pre-line">{profile.biography}</p>
            )}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-[#E1306C] font-semibold mt-1 hover:underline">
                <ExternalLink className="h-3 w-3" />{profile.website}
              </a>
            )}
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-3 rounded-xl border border-slate-100 divide-x divide-slate-100 bg-slate-50">
            {[
              { label: "Posts",     value: profile.media_count.toLocaleString() },
              { label: "Followers", value: n(profile.followers_count) },
              { label: "Following", value: n(profile.follows_count) },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col items-center py-3.5">
                <span className="text-[18px] font-bold text-slate-900">{value}</span>
                <span className="text-[11px] text-slate-500 font-medium mt-0.5">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Analytics overview ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Reach",    value: n(totalReach),    icon: Eye,           color: "text-sky-600",   bg: "bg-sky-50",   border: "border-sky-100" },
          { label: "Total Likes",    value: n(totalLikes),    icon: Heart,         color: "text-rose-500",  bg: "bg-rose-50",  border: "border-rose-100" },
          { label: "Total Comments", value: n(totalComments), icon: MessageCircle, color: "text-blue-600",  bg: "bg-blue-50",  border: "border-blue-100" },
          { label: "Total Shares",   value: n(totalShares),   icon: TrendingUp,    color: "text-green-600", bg: "bg-green-50", border: "border-green-100" },
          { label: "Total Saved",        value: n(totalSaved),       icon: Bookmark,     color: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-100" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`bg-white rounded-xl border ${border} shadow-sm px-4 py-3.5 flex items-center gap-3`}>
            <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[18px] font-bold text-slate-900 leading-none">{value}</p>
              <p className="text-[10px] text-slate-500 font-medium mt-1 leading-none">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Content type summary ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Photos",    count: photos.length,    icon: ImageLucide, color: "text-pink-600",   bg: "bg-pink-50" },
          { label: "Reels",     count: reels.length,     icon: Film,        color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Carousels", count: carousels.length, icon: Layers,      color: "text-orange-600", bg: "bg-orange-50" },
        ].map(({ label, count, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
            <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <div>
              <p className="text-[16px] font-bold text-slate-900">{count}</p>
              <p className="text-[10px] text-slate-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Posts grid ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-1">
            {([
              { key: "ALL",            label: "All",       icon: LayoutGrid,  count: media.length },
              { key: "IMAGE",          label: "Photos",    icon: ImageLucide, count: photos.length },
              { key: "VIDEO",          label: "Reels",     icon: Film,        count: reels.length },
              { key: "CAROUSEL_ALBUM", label: "Carousels", icon: Layers,      count: carousels.length },
            ] as { key: FilterType; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[]).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  filter === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${filter === key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          <button onClick={load} className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-700 transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {/* Grid */}
        <div className="p-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Grid3X3 className="h-10 w-10 text-slate-200" />
              <p className="text-[13px] text-slate-400">No {filter === "ALL" ? "posts" : filter.toLowerCase().replace("_album", "")} found</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
              {filtered.map((item) => (
                <PostTile key={item.id} item={item} onClick={() => setSelected(item)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && <PostDetailPanel item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function PostTile({ item, onClick }: { item: IgMedia; onClick: () => void }) {
  const thumb   = item.thumbnail_url ?? item.media_url
  const isReel  = item.media_type === "VIDEO"
  const isCarousel = item.media_type === "CAROUSEL_ALBUM"

  return (
    <button
      onClick={onClick}
      className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:border-[#E1306C] hover:shadow-lg transition-all duration-150"
    >
      {/* Media */}
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
          <ImageLucide className="h-7 w-7 text-purple-300" />
        </div>
      )}

      {/* Type badge */}
      <div className="absolute top-1.5 left-1.5">
        {isReel && (
          <span className="flex items-center gap-0.5 bg-black/70 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            <Film className="h-2.5 w-2.5" /> REEL
          </span>
        )}
        {isCarousel && (
          <span className="flex items-center gap-0.5 bg-black/70 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            <Layers className="h-2.5 w-2.5" /> ALBUM
          </span>
        )}
      </div>

      {/* Hover overlay — likes + comments in center */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/55 transition-all duration-150 flex flex-col items-center justify-center gap-1.5">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3 text-white text-[13px] font-bold drop-shadow">
          <span className="flex items-center gap-1">
            <Heart className="h-4 w-4 fill-white" /> {n(item.like_count)}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-4 w-4 fill-white" /> {n(item.comments_count)}
          </span>
        </div>
      </div>

      {/* Always-visible bottom bar: reach + date */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1.5">
        <div className="flex items-center justify-between text-white">
          <span className="text-[9px] font-medium opacity-70">{ago(item.timestamp)}</span>
          {item.reach > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-white">
              <Eye className="h-2.5 w-2.5" /> {n(item.reach)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function PostDetailPanel({ item, onClose }: { item: IgMedia; onClose: () => void }) {
  const thumb   = item.thumbnail_url ?? item.media_url
  const isReel  = item.media_type === "VIDEO"
  const isCarousel = item.media_type === "CAROUSEL_ALBUM"

  const typeLabel = isReel ? "Reel" : isCarousel ? "Carousel" : "Photo"
  const typeColor = isReel ? "bg-purple-100 text-purple-700" : isCarousel ? "bg-orange-100 text-orange-700" : "bg-pink-100 text-pink-700"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[800px] max-h-[92vh] overflow-hidden flex flex-col sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 h-8 w-8 rounded-full bg-black/25 hover:bg-black/45 flex items-center justify-center text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Media side */}
        <div className="sm:w-[52%] bg-black flex items-center justify-center min-h-[240px] shrink-0">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="max-h-[75vh] w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-3 p-12 text-slate-500">
              <ImageLucide className="h-14 w-14" />
              <span className="text-[12px]">No preview available</span>
            </div>
          )}
        </div>

        {/* Info side */}
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0">

          {/* Header */}
          <div className="px-5 pt-5 pb-3.5 border-b border-slate-100 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${typeColor}`}>
                {typeLabel}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">{ago(item.timestamp)}</span>
            </div>
            {item.caption ? (
              <p className="text-[13px] text-slate-700 leading-relaxed line-clamp-5">{item.caption}</p>
            ) : (
              <p className="text-[12px] text-slate-400 italic">No caption</p>
            )}
            <a
              href={item.permalink} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-[#E1306C] font-semibold hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> View on Instagram
            </a>
          </div>

          {/* Engagement metrics */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Engagement</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Likes",          value: item.like_count,     icon: Heart,         color: "text-rose-500",   bg: "bg-rose-50" },
                { label: "Comments",       value: item.comments_count, icon: MessageCircle, color: "text-blue-500",   bg: "bg-blue-50" },
                { label: "Saved",          value: item.saved,          icon: Bookmark,      color: "text-amber-500",  bg: "bg-amber-50" },
                { label: "Shares",         value: item.shares,         icon: TrendingUp,    color: "text-green-500",  bg: "bg-green-50" },
                ...(isReel ? [{ label: "Video Views", value: item.video_views, icon: Play, color: "text-purple-500", bg: "bg-purple-50" }] : []),
                { label: "Total",          value: item.total_interactions, icon: Users,     color: "text-slate-500",  bg: "bg-slate-50" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`flex items-center gap-2.5 rounded-xl ${bg} px-3 py-2.5`}>
                  <Icon className={`h-4 w-4 ${color} shrink-0`} />
                  <div>
                    <p className="text-[15px] font-bold text-slate-900 leading-none">{n(value)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reach */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Reach</p>
            {item.reach === 0 ? (
              <p className="text-[12px] text-slate-400 italic">
                Reach data not available. Ensure your access token includes the <code className="bg-slate-100 px-1 rounded text-[11px]">instagram_business_manage_insights</code> permission.
              </p>
            ) : (
              <div>
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-[12px] text-slate-600 font-semibold">Unique accounts reached</span>
                  <span className="text-[18px] font-bold text-[#E1306C]">{item.reach.toLocaleString()}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#E1306C] to-[#F77737]" style={{ width: "100%" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-5 animate-pulse">
      <div className="bg-white rounded-2xl border border-slate-100 h-56" />
      <div className="grid grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl h-20 border border-slate-100" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl h-16 border border-slate-100" />)}
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-3">
        <div className="grid grid-cols-6 gap-1.5">
          {[...Array(24)].map((_, i) => <div key={i} className="aspect-square rounded-xl bg-slate-100" />)}
        </div>
      </div>
    </div>
  )
}
