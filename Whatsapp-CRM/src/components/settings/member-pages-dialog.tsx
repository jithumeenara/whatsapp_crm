'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/navigation/sections'
import { defaultPagesFor } from '@/lib/auth/page-access'
import type { AccountRole } from '@/lib/auth/roles'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Which screens one member may open.
 *
 * ── Why this is per person ──────────────────────────────────────────
 *
 * Roles decide what somebody may *do*. This decides what they are
 * handed, and two agents doing different jobs are given different
 * menus — the one who only answers chats does not need Broadcasts on
 * screen, and the one who runs campaigns does.
 *
 * ── The two states that look the same and are not ───────────────────
 *
 * "Using the default for their role" and "an admin ticked exactly the
 * default set" are different, and the dialog has to keep them apart.
 * The first follows the role: change somebody from agent to supervisor
 * and their pages change with them. The second is frozen — it stays
 * what was ticked, whatever their role becomes later.
 *
 * So "Reset to default" is its own button rather than a tick-everything
 * shortcut, and the card says which state it is in.
 */

interface Member {
  user_id: string
  full_name: string
  role: AccountRole
  /** Raw, as stored: null when nobody has decided for this person. */
  page_access?: string[] | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: Member
  onSaved?: () => void
}

export function MemberPagesDialog({ open, onOpenChange, member, onSaved }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [following, setFollowing] = useState(true)
  const [saving, setSaving] = useState(false)

  const roleDefault = useMemo(
    () => defaultPagesFor(member.role),
    [member.role],
  )

  useEffect(() => {
    if (!open) return
    const stored = member.page_access
    // Array — even an empty one — is a decision. Null is not.
    if (Array.isArray(stored)) {
      setFollowing(false)
      setPicked(new Set(stored))
    } else {
      setFollowing(true)
      setPicked(new Set(roleDefault))
    }
  }, [open, member.page_access, roleDefault])

  function toggle(href: string) {
    // Touching a tick is itself the decision to stop following the role
    // default — otherwise saving would look like it did nothing.
    setFollowing(false)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      return next
    })
  }

  function resetToDefault() {
    setFollowing(true)
    setPicked(new Set(roleDefault))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // null is how the server is told to forget the choice and go
        // back to following the role.
        body: JSON.stringify({ page_access: following ? null : [...picked] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Save failed: HTTP ${res.status}`)
      }
      toast.success(
        following
          ? `${member.full_name} follows the ${member.role} default again`
          : `Saved — ${picked.size} page${picked.size === 1 ? '' : 's'}`,
      )
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // An owner or admin is never restricted — one wrong click here would
  // otherwise remove the only account that could undo it. Saying so is
  // better than showing ticks that do nothing.
  const unrestrictable = member.role === 'owner' || member.role === 'admin'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pages for {member.full_name}</DialogTitle>
          <DialogDescription>
            {unrestrictable
              ? 'Administrators always have every page.'
              : 'Tick the screens this person can open. Everything else is refused, not just hidden.'}
          </DialogDescription>
        </DialogHeader>

        {unrestrictable ? (
          <p className="rounded-xl bg-slate-50 p-4 text-[13px] leading-relaxed text-slate-600">
            Turning a page off for an administrator would let one wrong click
            remove the only account that could turn it back on. Change their
            role first if their access needs to be limited.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-[12.5px] text-slate-600">
                {following
                  ? `Following the ${member.role} default`
                  : `${picked.size} of ${roleDefault.length > 0 ? grantableCount() : 0} chosen for this person`}
              </span>
              {!following && (
                <button
                  type="button"
                  onClick={resetToDefault}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo-600 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to default
                </button>
              )}
            </div>

            <div className="space-y-4">
              {NAV_SECTIONS.map((section) => (
                <div key={section.label}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    {section.label}
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {section.items.map((item) => (
                      <label
                        key={item.href}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(item.href)}
                          onChange={() => toggle(item.href)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {picked.size === 0 && !following && (
              <p className="rounded-xl bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-800">
                With nothing ticked this person can sign in but reaches no screen
                at all. That is a real setting — use it to suspend somebody —
                but it is rarely what is meant.
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-xl px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          {!unrestrictable && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#5B6CF9] px-4 text-[13px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function grantableCount(): number {
  return NAV_SECTIONS.reduce((n, s) => n + s.items.length, 0)
}
