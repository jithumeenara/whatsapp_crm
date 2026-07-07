"use client";

import { useState, useEffect, useCallback } from "react";
import type { Contact, ContactNote, Tag } from "@/types";
import {
  Phone,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  MessageSquare,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;
    try {
      const res = await fetch(`/api/contacts/${contact.id}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.notes) setNotes(body.notes);
      if (body.tags) setTags(body.tags);
    } catch {
      // ignore
    }
  }, [contact]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note_text: newNote.trim() }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.note) setNotes((prev) => [body.note, ...prev]);
        setNewNote("");
      }
    } catch {
      // ignore
    } finally {
      setAddingNote(false);
    }
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-[280px] flex-col items-center justify-center border-l border-slate-200 bg-white">
        <MessageSquare className="mb-3 h-8 w-8 text-slate-500/30" />
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // Build info rows from contact fields
  const infoRows: { label: string; value: string }[] = [];
  if (contact.email) infoRows.push({ label: "Email", value: contact.email });
  if (contact.phone) infoRows.push({ label: "Phone", value: contact.phone });
  if (contact.company) infoRows.push({ label: "Company", value: contact.company });
  if (contact.location) infoRows.push({ label: "Location", value: contact.location });
  if (contact.created_at) infoRows.push({ label: "Contact", value: format(new Date(contact.created_at), "dd/MM/yyyy h:mm a") });

  // Custom attributes
  const attrs = (contact as unknown as Record<string, unknown>).attributes as Record<string, string> | undefined;
  if (attrs && typeof attrs === "object") {
    for (const [key, val] of Object.entries(attrs)) {
      if (val && typeof val === "string" && val.trim()) {
        infoRows.push({ label: key.replace(/_/g, " "), value: val });
      }
    }
  }

  return (
    <div className="flex h-full w-[280px] flex-col border-l border-slate-200 bg-white">
      <ScrollArea className="flex-1">
        {/* Avatar + name */}
        <div className="flex flex-col items-center border-b border-slate-200 px-4 py-6 text-center">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-2xl font-bold text-slate-800/60">
              {contact.avatar_url ? (
                <img src={contact.avatar_url} alt={displayName} className="h-20 w-20 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            {/* WhatsApp badge */}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm">
              <Phone className="h-3 w-3" />
            </span>
          </div>
          <h3 className="mt-3 text-[17px] font-semibold text-slate-800">{displayName}</h3>
          {contact.company && (
            <p className="mt-0.5 text-[13px] text-slate-500">{contact.company}</p>
          )}
        </div>

        {/* Info rows */}
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="space-y-0">
            {infoRows.map((row) => (
              <div key={row.label} className="flex items-start gap-2 py-2.5">
                <span className="w-[90px] shrink-0 text-[13px] capitalize text-slate-500">
                  {row.label}
                </span>
                {row.label === "Phone" ? (
                  <button
                    onClick={handleCopyPhone}
                    className="flex flex-1 items-center gap-1.5 text-left text-[14px] font-medium text-slate-800 hover:text-primary"
                  >
                    <span className="truncate">{row.value}</span>
                    {copied
                      ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      : <Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    }
                  </button>
                ) : (
                  <span className="flex-1 truncate text-[14px] font-medium text-slate-800">
                    {row.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500">
            <TagIcon className="h-3.5 w-3.5" />
            Tags
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.length === 0 ? (
              <p className="text-[13px] text-slate-500">No tags</p>
            ) : (
              tags.map((tag) => (
                <span
                  key={tag.contact_tag_id}
                  className="rounded-full px-2.5 py-0.5 text-[12.5px] font-medium"
                  style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                >
                  {tag.name}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-slate-500">
            <StickyNote className="h-3.5 w-3.5" />
            Notes
          </div>
          <div className="flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note..."
              rows={2}
              className="flex-1 resize-none rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
            />
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
              className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[13px] text-slate-800/80">{note.note_text}</p>
                <p className="mt-1.5 text-[12px] text-slate-500">
                  {format(new Date(note.created_at), "MMM d, yyyy · HH:mm")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
