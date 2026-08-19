'use client'

import { useState } from 'react'
import { CalendarClock, CalendarPlus, ListChecks } from 'lucide-react'
import { ScheduleMessageDialog } from './schedule-message-dialog'
import { ScheduledMessagesPanel } from './scheduled-messages-panel'

interface ScheduleMenuButtonProps {
  conversationId: string
  disabled?: boolean
}

/** Single entry point for scheduled messages — one icon, a small menu with
 *  "New Schedule" and "View Schedule". Shared by the main Inbox composer
 *  and the Lead page's chat composer. */
export function ScheduleMenuButton({ conversationId, disabled }: ScheduleMenuButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  return (
    <>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled}
          title="Scheduled messages"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40"
        >
          <CalendarClock className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-11 left-0 z-50 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setScheduleOpen(true) }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <CalendarPlus className="h-4 w-4 shrink-0 text-indigo-500" /> New Schedule
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setListOpen(true) }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <ListChecks className="h-4 w-4 shrink-0 text-indigo-500" /> View Schedule
              </button>
            </div>
          </>
        )}
      </div>

      <ScheduleMessageDialog open={scheduleOpen} onOpenChange={setScheduleOpen} conversationId={conversationId} />
      <ScheduledMessagesPanel open={listOpen} onOpenChange={setListOpen} conversationId={conversationId} />
    </>
  )
}
