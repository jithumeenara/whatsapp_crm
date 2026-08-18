'use client'

import { useState } from 'react'
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react'
import { Smile } from 'lucide-react'

interface EmojiPickerPopoverProps {
  onSelect: (emoji: string) => void
  disabled?: boolean
  /** Anchor the popover above (default) or below the button. */
  side?: 'top' | 'bottom'
}

/** Full emoji picker (all emoji, categories, search) — used by both the
 *  main Inbox composer and the Lead page's chat composer. */
export function EmojiPickerPopover({ onSelect, disabled, side = 'top' }: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Emoji"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40"
      >
        <Smile className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={side === 'top' ? 'absolute bottom-11 left-0 z-50' : 'absolute top-11 left-0 z-50'}>
            <EmojiPicker
              onEmojiClick={(data: EmojiClickData) => {
                onSelect(data.emoji)
                setOpen(false)
              }}
              theme={Theme.LIGHT}
              autoFocusSearch
              width={320}
              height={400}
              searchPlaceHolder="Search emoji"
              previewConfig={{ showPreview: false }}
            />
          </div>
        </>
      )}
    </div>
  )
}
