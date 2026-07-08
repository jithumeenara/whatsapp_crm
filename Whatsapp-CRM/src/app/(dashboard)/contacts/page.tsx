"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { toast } from "sonner"
import type { Contact, Tag } from "@/types"
import {
  Users, Search, Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  Phone, Mail, Upload, MoreHorizontal, MessageSquare, SortAsc,
  Tag as TagIcon, X, ChevronDown, Camera,
} from "lucide-react"
import { ContactForm } from "@/components/contacts/contact-form"
import { ContactDetailViewV2 } from "@/components/contacts/contact-detail-view-v2"
import { ImportModal } from "@/components/contacts/import-modal"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { formatDistanceToNow } from "date-fns"

const PAGE_SIZE = 25

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

function ChannelBadges({ channels }: { channels?: string[] }) {
  if (!channels || channels.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1 ml-1.5">
      {channels.includes("whatsapp") && (
        <span title="WhatsApp" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#25D366]">
          {/* WhatsApp checkmark logo */}
          <svg viewBox="0 0 24 24" fill="white" className="h-2.5 w-2.5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </span>
      )}
      {channels.includes("instagram") && (
        <span title="Instagram" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#f09433] via-[#e6683c] to-[#833ab4]">
          <Camera className="h-2 w-2 text-white" />
        </span>
      )}
    </span>
  )
}

function initials(contact: Contact) {
  if (contact.name) return contact.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
  return contact.phone.slice(-2)
}

const GRADIENTS = [
  "from-indigo-400 to-indigo-600",
  "from-emerald-400 to-emerald-600",
  "from-violet-400 to-violet-600",
  "from-sky-400 to-sky-600",
  "from-amber-400 to-amber-600",
  "from-rose-400 to-rose-600",
]
function avatarGrad(id: string) {
  const s = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return GRADIENTS[s % GRADIENTS.length]
}

interface ContactWithTags extends Contact {
  tags?: Tag[]
}

type SortKey = "name_asc" | "name_desc" | "date_desc" | "date_asc"
const SORT_LABELS: Record<SortKey, string> = {
  name_asc: "Name A → Z",
  name_desc: "Name Z → A",
  date_desc: "Newest first",
  date_asc: "Oldest first",
}

function relTime(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) } catch { return "" }
}

function DeleteConfirm({ contactName, deleting, onCancel, onConfirm }: {
  contactName: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => !deleting && onCancel()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/60 overflow-hidden">

        {/* Red accent top bar */}
        <div className="h-1.5 bg-gradient-to-r from-rose-500 to-rose-400" />

        <div className="p-6">
          {/* Icon + text */}
          <div className="flex flex-col items-center text-center gap-4 mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100 shadow-sm">
              <Trash2 className="h-7 w-7 text-rose-500" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900">Delete Contact?</h2>
              <p className="mt-2 text-[13px] text-slate-500 leading-relaxed max-w-[260px]">
                <span className="font-semibold text-slate-700">{contactName}</span> and all their messages will be permanently deleted. This cannot be undone.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Keep Contact
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-700 active:bg-rose-800 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm shadow-rose-200"
            >
              {deleting
                ? <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> Deleting…</>
                : <><Trash2 className="h-3.5 w-3.5" /> Delete</>
              }
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

function BulkDeleteConfirm({ count, deleting, onCancel, onConfirm }: {
  count: number
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => !deleting && onCancel()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/60 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-rose-500 to-rose-400" />
        <div className="p-6">
          <div className="flex flex-col items-center text-center gap-4 mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100 shadow-sm">
              <Trash2 className="h-7 w-7 text-rose-500" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900">Delete {count} Contact{count !== 1 ? "s" : ""}?</h2>
              <p className="mt-2 text-[13px] text-slate-500 leading-relaxed max-w-[260px]">
                These <span className="font-semibold text-slate-700">{count} contacts</span> and all their messages will be permanently deleted. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} disabled={deleting}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={onConfirm} disabled={deleting}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-700 active:bg-rose-800 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm shadow-rose-200">
              {deleting
                ? <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> Deleting…</>
                : <><Trash2 className="h-3.5 w-3.5" /> Delete All</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ContactsV2() {
  const { accountRole } = useAuth()
  const canManage = hasMinRole(accountRole ?? "viewer", "agent")

  const [contacts, setContacts] = useState<ContactWithTags[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [search, setSearch] = useState("")
  const [searchQ, setSearchQ] = useState("")
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Filters / sort
  const [sortKey, setSortKey] = useState<SortKey>("date_desc")
  const [filterTagId, setFilterTagId] = useState<string | null>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const [tagFilterOpen, setTagFilterOpen] = useState(false)

  // Selection / modals
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Bulk selection
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<HTMLDivElement>(null)

  // Close sort/tag dropdowns on outside click (mousedown is fine for these — no DOM removal race)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagFilterOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const loadContacts = useCallback(async () => {
    setCheckedIds(new Set())
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (searchQ) params.set("search", searchQ)
      const [cr, tr] = await Promise.all([
        fetch(`/api/contacts?${params}`).then((r) => r.json()),
        fetch("/api/tags").then((r) => r.json()),
      ])
      const tagsArr: Tag[] = tr?.tags ?? []
      setContacts(cr.contacts ?? [])
      setTotal(cr.total ?? 0)
      setAllTags(tagsArr)
    } catch {
      toast.error("Failed to load contacts")
    } finally {
      setLoading(false)
    }
  }, [page, searchQ])

  useEffect(() => { loadContacts() }, [loadContacts])

  function handleSearch(v: string) {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); setSearchQ(v) }, 350)
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to delete contact")
        return
      }
      toast.success("Contact deleted")
      setDeleteId(null)
      loadContacts()
    } catch {
      toast.error("Failed to delete contact")
    } finally {
      setDeleting(false)
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    try {
      await Promise.all([...checkedIds].map((id) => fetch(`/api/contacts/${id}`, { method: "DELETE" })))
      toast.success(`${checkedIds.size} contact${checkedIds.size !== 1 ? "s" : ""} deleted`)
      setCheckedIds(new Set())
      setBulkDeleteConfirm(false)
      loadContacts()
    } catch {
      toast.error("Failed to delete some contacts")
    } finally {
      setBulkDeleting(false)
    }
  }

  // Client-side sort + tag filter on the already-fetched page
  const displayed = useMemo(() => {
    let list = contacts
    if (filterTagId) list = list.filter((c) => c.tags?.some((t) => t.id === filterTagId))
    switch (sortKey) {
      case "name_asc": list = [...list].sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone)); break
      case "name_desc": list = [...list].sort((a, b) => (b.name ?? b.phone).localeCompare(a.name ?? a.phone)); break
      case "date_asc": list = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); break
      case "date_desc": list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break
    }
    return list
  }, [contacts, sortKey, filterTagId])

  const allChecked = displayed.length > 0 && displayed.every((c) => checkedIds.has(c.id))
  const someChecked = displayed.some((c) => checkedIds.has(c.id))

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const filterTag = filterTagId ? allTags.find((t) => t.id === filterTagId) : null
  const rangeStart = page * PAGE_SIZE + 1
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div className="flex h-full flex-col bg-slate-50">

      {/* â”€â”€ Toolbar â”€â”€ */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Left: title + count */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm">
              <Users className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900 leading-tight">Contacts</h1>
              <p className="text-[12px] text-slate-500 leading-tight">
                {loading ? "Loading…" : `${total.toLocaleString()} contact${total !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2">
            {checkedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-600 shadow-sm hover:bg-rose-100 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {checkedIds.size}
              </button>
            )}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New Contact
              </button>
            )}
          </div>
        </div>

        {/* Search + filter row */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Search box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-colors"
              placeholder="Search by name, phone or email…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPage(0); setSearchQ("") }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Tag filter dropdown */}
          {allTags.length > 0 && (
            <div className="relative" ref={tagRef}>
              <button
                type="button"
                onClick={() => setTagFilterOpen((v) => !v)}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors",
                  filterTag
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                <TagIcon className="h-3.5 w-3.5" />
                {filterTag ? (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: filterTag.color }} />
                    {filterTag.name}
                  </span>
                ) : "Filter by tag"}
                <ChevronDown className="h-3 w-3 text-current opacity-60" />
              </button>
              {tagFilterOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 w-48 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                  <button
                    type="button"
                    onClick={() => { setFilterTagId(null); setTagFilterOpen(false) }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-slate-50",
                      !filterTagId ? "font-semibold text-indigo-600" : "text-slate-700"
                    )}
                  >
                    All tags
                  </button>
                  {allTags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setFilterTagId(t.id); setTagFilterOpen(false) }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-slate-50",
                        filterTagId === t.id ? "font-semibold text-indigo-600" : "text-slate-700"
                      )}
                    >
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sort dropdown */}
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <SortAsc className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{SORT_LABELS[sortKey]}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { setSortKey(k); setSortOpen(false) }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-[13px] hover:bg-slate-50",
                      sortKey === k ? "font-semibold text-indigo-600" : "text-slate-700"
                    )}
                  >
                    {label}
                    {sortKey === k && <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* â”€â”€ Table â”€â”€ */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[13px] border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100/80 backdrop-blur-sm">
              <th className="pl-4 pr-2 py-2.5 border-b border-slate-200 w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                  onChange={() => {
                    if (allChecked) setCheckedIds(new Set())
                    else setCheckedIds(new Set(displayed.map((c) => c.id)))
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </th>
              <th className="px-6 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">Contact</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 hidden sm:table-cell">Phone</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 hidden md:table-cell">Email</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 hidden lg:table-cell">Tags</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200 hidden xl:table-cell">Added</th>
              <th className="px-3 py-2.5 border-b border-slate-200 w-10" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {loading ? (
              [...Array(7)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="pl-4 pr-2 py-4" />
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3.5">
                      <div className="h-11 w-11 rounded-xl bg-slate-100 shrink-0" />
                      <div className="space-y-2">
                        <div className="h-3.5 w-32 rounded-full bg-slate-100" />
                        <div className="h-3 w-20 rounded-full bg-slate-100" />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell"><div className="h-9 w-36 rounded-lg bg-slate-100" /></td>
                  <td className="px-4 py-4 hidden md:table-cell"><div className="h-3.5 w-40 rounded-full bg-slate-100" /></td>
                  <td className="px-4 py-4 hidden lg:table-cell"><div className="h-6 w-16 rounded-full bg-slate-100" /></td>
                  <td className="px-4 py-4 hidden xl:table-cell"><div className="h-3 w-20 rounded-full bg-slate-100" /></td>
                  <td className="px-3 py-4" />
                </tr>
              ))
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mb-4">
                      <Users className="h-8 w-8 text-slate-300" />
                    </div>
                    <p className="text-[15px] font-semibold text-slate-700">
                      {searchQ || filterTag ? "No contacts match" : "No contacts yet"}
                    </p>
                    <p className="mt-1 text-[13px] text-slate-400 max-w-xs">
                      {searchQ
                        ? "Try a different name, phone number or email."
                        : filterTag
                          ? `No contacts tagged "${filterTag.name}".`
                          : "Add your first contact or import a CSV file."}
                    </p>
                    {!searchQ && !filterTag && canManage && (
                      <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Contact
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              displayed.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => setSelectedId(contact.id)}
                  className="group cursor-pointer hover:bg-indigo-50/40 transition-colors"
                >
                  {/* Checkbox column */}
                  <td className="pl-4 pr-2 py-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checkedIds.has(contact.id)}
                      onChange={(e) => {
                        setCheckedIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(contact.id)
                          else next.delete(contact.id)
                          return next
                        })
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </td>
                  {/* Contact column */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3.5">
                      {contact.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={contact.avatar_url}
                          alt={contact.name ?? ""}
                          className="h-11 w-11 rounded-xl object-cover shrink-0 shadow-sm"
                        />
                      ) : (
                        <div className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white text-[13px] font-black shadow-sm",
                          avatarGrad(contact.id)
                        )}>
                          {initials(contact)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-0.5">
                          <p className="text-[14px] font-semibold text-slate-900 truncate leading-snug">
                            {contact.name || <span className="font-normal text-slate-400 italic">Unnamed</span>}
                          </p>
                          <ChannelBadges channels={contact.channels} />
                        </div>
                        {/* Show phone under name on mobile (phone col hidden) */}
                        <p className="text-[12px] text-slate-400 truncate sm:hidden">{contact.phone}</p>
                        {contact.company && (
                          <p className="text-[12px] text-slate-400 truncate hidden sm:block">{contact.company}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Phone column */}
                  <td className="px-4 py-4 hidden sm:table-cell">
                    <a
                      href={`tel:${contact.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors group/phone"
                    >
                      <Phone className="h-3.5 w-3.5 text-slate-400 group-hover/phone:text-emerald-500 transition-colors" />
                      {contact.phone}
                    </a>
                  </td>

                  {/* Email column */}
                  <td className="px-4 py-4 hidden md:table-cell">
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-[13px] text-slate-600 hover:text-indigo-600 transition-colors max-w-[180px]"
                      >
                        <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    ) : (
                      <span className="text-slate-300 text-[13px]">—</span>
                    )}
                  </td>

                  {/* Tags column */}
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      {(contact.tags ?? []).slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{ background: tag.color + "20", color: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {(contact.tags?.length ?? 0) > 3 && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                          +{(contact.tags?.length ?? 0) - 3}
                        </span>
                      )}
                      {(contact.tags?.length ?? 0) === 0 && (
                        <span className="text-slate-300 text-[13px]">—</span>
                      )}
                    </div>
                  </td>

                  {/* Added column */}
                  <td className="px-4 py-4 hidden xl:table-cell">
                    <span className="text-[12px] text-slate-400" title={new Date(contact.created_at).toLocaleDateString()}>
                      {relTime(contact.created_at)}
                    </span>
                  </td>

                  {/* Actions column */}
                  <td className="px-3 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {/* Quick: open inbox for this contact */}
                      <a
                        href={`/inbox`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                        title="Message"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </a>

                      {/* ⋯ dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId((v) => v === contact.id ? null : contact.id) }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>

                        {openMenuId === contact.id && (
                          <>
                            {/* Transparent backdrop — clicking outside closes menu */}
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setOpenMenuId(null)}
                            />
                            {/* Menu floats above backdrop */}
                            <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border border-slate-200 bg-white shadow-xl py-1 overflow-hidden">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSelectedId(contact.id); setOpenMenuId(null) }}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5 text-slate-400" /> Edit
                              </button>
                              <div className="border-t border-slate-100 my-0.5" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeleteId(contact.id); setOpenMenuId(null) }}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-rose-600 hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* â”€â”€ Pagination â”€â”€ */}
      {total > 0 && (
        <div className="shrink-0 flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3">
          <p className="text-[12px] text-slate-500">
            {loading ? "Loading…" : total > PAGE_SIZE ? `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()} contacts` : `${total} contact${total !== 1 ? "s" : ""}`}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Page number pills */}
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = totalPages <= 5 ? i : Math.min(Math.max(page - 2, 0) + i, totalPages - 1)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-medium transition-colors",
                      page === p
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm"
                    )}
                  >
                    {p + 1}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* â”€â”€ Modals â”€â”€ */}

      {/* Create new contact */}
      <ContactForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => { setCreateOpen(false); loadContacts() }}
      />

      {/* View / edit contact detail — V2 panel */}
      <ContactDetailViewV2
        open={!!selectedId}
        onOpenChange={(v) => { if (!v) setSelectedId(null) }}
        contactId={selectedId}
        onUpdated={loadContacts}
      />

      {/* Import CSV */}
      {importOpen && (
        <ImportModal
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={loadContacts}
        />
      )}

      {/* Bulk delete confirm dialog */}
      {bulkDeleteConfirm && (
        <BulkDeleteConfirm
          count={checkedIds.size}
          deleting={bulkDeleting}
          onCancel={() => setBulkDeleteConfirm(false)}
          onConfirm={handleBulkDelete}
        />
      )}

      {/* Delete confirm dialog */}
      {deleteId && (
        <DeleteConfirm
          contactName={contacts.find((c) => c.id === deleteId)?.name || contacts.find((c) => c.id === deleteId)?.phone || "This contact"}
          deleting={deleting}
          onCancel={() => setDeleteId(null)}
          onConfirm={() => handleDelete(deleteId)}
        />
      )}
    </div>
  )
}
