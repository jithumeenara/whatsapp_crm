"use client"

/**
 * The channels one contact is on — WhatsApp, Telegram, Instagram, SMS… —
 * each with its own mark, each a link to that chat in the Inbox. One
 * person, one contact entry; their chats on every channel hang off it.
 */

import Link from "next/link"
import type { ComponentType } from "react"
import { Globe, Mail, MessageSquare, Radio } from "lucide-react"
import { FacebookIcon, InstagramIcon, TelegramIcon, WhatsAppIcon } from "@/components/icons/brand-icons"
import { cn } from "@/lib/utils"

type Mark = ComponentType<{ className?: string }>

/** Protocols with no single brand mark get a plain icon on their colour. */
function plain(Icon: ComponentType<{ className?: string }>, bg: string): Mark {
  function PlainMark({ className }: { className?: string }) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full", bg, className)} aria-hidden="true">
        <Icon className="h-[60%] w-[60%] text-white" />
      </span>
    )
  }
  return PlainMark
}

export const CHANNEL_DISPLAY: Record<string, { label: string; Mark: Mark }> = {
  whatsapp: { label: "WhatsApp", Mark: WhatsAppIcon },
  telegram: { label: "Telegram", Mark: TelegramIcon },
  instagram: { label: "Instagram", Mark: InstagramIcon },
  facebook: { label: "Messenger", Mark: FacebookIcon },
  sms: { label: "SMS", Mark: plain(MessageSquare, "bg-indigo-500") },
  rcs: { label: "RCS", Mark: plain(Radio, "bg-violet-500") },
  email: { label: "Email", Mark: plain(Mail, "bg-sky-600") },
  website: { label: "Website", Mark: plain(Globe, "bg-orange-600") },
}

const ORDER = Object.keys(CHANNEL_DISPLAY)

function sorted<T extends { channel: string }>(items: T[]): T[] {
  const rank = (c: string) => (ORDER.indexOf(c) === -1 ? ORDER.length : ORDER.indexOf(c))
  return [...items].sort((a, b) => rank(a.channel) - rank(b.channel))
}

export function ChannelMark({ channel, className }: { channel: string; className?: string }) {
  const d = CHANNEL_DISPLAY[channel]
  if (!d) return <MessageSquare className={cn("text-slate-400", className)} aria-hidden="true" />
  return <d.Mark className={className} />
}

/** Small marks in a row (Contacts list); each opens that chat when it has one. */
export function ChannelMarks({ links }: { links: Array<{ channel: string; conversation_id?: string | null }> }) {
  if (!links || links.length === 0) return null
  return (
    <span className="ml-1.5 inline-flex items-center gap-1">
      {sorted(links).map((l) => {
        const label = CHANNEL_DISPLAY[l.channel]?.label ?? l.channel
        return l.conversation_id ? (
          <Link
            key={l.channel}
            href={`/inbox?c=${l.conversation_id}`}
            title={`Open ${label} chat`}
            aria-label={`Open ${label} chat`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex rounded-full transition-transform hover:scale-110"
          >
            <ChannelMark channel={l.channel} className="h-4 w-4" />
          </Link>
        ) : (
          <span key={l.channel} title={label} className="inline-flex">
            <ChannelMark channel={l.channel} className="h-4 w-4" />
          </span>
        )
      })}
    </span>
  )
}

/** Labelled links (contact panel): every channel this person is on. */
export function ChannelLinks({
  links,
  currentConversationId,
}: {
  links: Array<{ channel: string; conversation_id: string }>
  currentConversationId?: string | null
}) {
  if (!links || links.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {sorted(links).map((l) => {
        const label = CHANNEL_DISPLAY[l.channel]?.label ?? l.channel
        const here = l.conversation_id === currentConversationId
        return (
          <li key={l.conversation_id}>
            {here ? (
              <span
                aria-current="page"
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-1 pr-2.5 text-[12px] font-semibold text-indigo-700"
              >
                <ChannelMark channel={l.channel} className="h-5 w-5" />
                {label}
              </span>
            ) : (
              <Link
                href={`/inbox?c=${l.conversation_id}`}
                title={`Open ${label} chat`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-[12px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <ChannelMark channel={l.channel} className="h-5 w-5" />
                {label}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
