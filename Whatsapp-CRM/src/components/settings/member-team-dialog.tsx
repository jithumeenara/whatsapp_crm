'use client'

/**
 * Which team one member belongs to, for the Spending report's "by team".
 * A person is in one team; an empty name takes them out. The name is free
 * text so a business uses its own words, with its existing teams offered as
 * suggestions so "Sales" and "sales " do not become two teams.
 */

import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UsersRound } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, errorText } from '@/lib/api-fetch'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { user_id: string; full_name: string; team?: string | null }
  /** Teams that already exist, offered as suggestions. */
  teams: string[]
  onSaved: () => void
}

export function MemberTeamDialog({ open, onOpenChange, member, teams, onSaved }: Props) {
  const [team, setTeam] = useState('')
  const [saving, setSaving] = useState(false)
  const listId = useId()

  // Reset on open, not on mount: one dialog serves whichever row was clicked.
  useEffect(() => {
    if (open) setTeam(member.team ?? '')
  }, [open, member.team])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await apiFetch(`/api/account/members/${member.user_id}/team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: team.trim() || null }),
      })
      toast.success(team.trim() ? 'Team saved' : 'Taken out of their team')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error('[member-team] save failed:', err)
      toast.error(errorText(err, 'Could not save the team.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
              <UsersRound className="h-4 w-4" />
            </span>
            Team for {member.full_name || 'this member'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Spending reports add up messages and AI help by team. Leave it empty for no team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={`${listId}-input`} className="block text-[12.5px] font-medium text-slate-700">Team name</label>
          <Input
            id={`${listId}-input`}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } }}
            list={listId}
            maxLength={60}
            autoComplete="off"
            placeholder="e.g. Sales"
            className="h-10 rounded-xl border-slate-200 text-[13px]"
          />
          <datalist id={listId}>
            {teams.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
