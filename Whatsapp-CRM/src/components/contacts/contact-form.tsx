'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import type { ExistingContact } from '@/lib/contacts/dedupe';
import { Loader2, AlertTriangle, X, User, Phone, Mail, Building2, Tag as TagIcon, CheckCircle2 } from 'lucide-react';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
  onViewExisting?: (contactId: string) => void;
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const { accountId } = useAuth();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  const [dupMatch, setDupMatch] = useState<{ contact: ExistingContact; exact: boolean } | null>(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      setDupMatch(null);
      fetchTags();
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, contact]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  async function checkDuplicate() {
    if (isEdit || !accountId) return;
    const value = phone.trim();
    if (!value) { setDupMatch(null); return; }
    setCheckingDup(true);
    try {
      const res = await fetch(`/api/contacts/check-duplicate?phone=${encodeURIComponent(value)}`);
      if (res.ok) {
        const json = await res.json();
        setDupMatch(json.match ?? null);
      }
    } finally {
      setCheckingDup(false);
    }
  }

  async function fetchTags() {
    setLoadingTags(true);
    const res = await fetch('/api/tags', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      setTags(json.tags ?? []);
    }
    setLoadingTags(false);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { toast.error('Phone number is required'); return; }
    if (!isEdit && dupMatch?.exact) { toast.error('A contact with this phone number already exists'); return; }

    setSaving(true);
    try {
      let contactId = contact?.id;

      if (isEdit && contactId) {
        const res = await fetch(`/api/contacts/${contactId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() || null, phone: phone.trim(), email: email.trim() || null, company: company.trim() || null }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to update contact');
        }
      } else {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() || null, phone: phone.trim(), email: email.trim() || null, company: company.trim() || null }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          if (res.status === 409 || (json.error ?? '').toLowerCase().includes('unique')) {
            toast.error('A contact with this phone number already exists');
            const dupRes = await fetch(`/api/contacts/check-duplicate?phone=${encodeURIComponent(phone.trim())}`);
            if (dupRes.ok) {
              const dupJson = await dupRes.json();
              if (dupJson.match) setDupMatch(dupJson.match);
            }
            return;
          }
          throw new Error(json.error ?? 'Failed to create contact');
        }
        const json = await res.json();
        contactId = json.contact?.id;
      }

      if (contactId) {
        await fetch(`/api/contacts/${contactId}/tags`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_ids: selectedTagIds }),
        });
      }

      toast.success(isEdit ? 'Contact updated' : 'Contact created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={() => !saving && onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/60 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-slate-100 shrink-0">
          {isEdit && name ? (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 text-white text-[14px] font-black shadow-sm">
              {initials(name)}
            </div>
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
              <User className="h-5 w-5 text-indigo-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-slate-900 leading-tight">
              {isEdit ? 'Edit Contact' : 'New Contact'}
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {isEdit ? 'Update the contact details below.' : 'Fill in the details to add a new contact.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onOpenChange(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

            {/* Name + Company — two columns */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="cf-name" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    ref={firstInputRef}
                    id="cf-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cf-company" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Company
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    id="cf-company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Acme Inc."
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="cf-phone" className="flex items-center gap-1 text-[12px] font-semibold text-slate-700 mb-1.5">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  id="cf-phone"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); if (dupMatch) setDupMatch(null); }}
                  onBlur={checkDuplicate}
                  placeholder="+91 98765 43210"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors font-mono"
                />
                {checkingDup && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-slate-400" />
                )}
              </div>
              {dupMatch ? (
                <div className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] ${dupMatch.exact ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">
                      {dupMatch.exact ? 'Phone number already exists.' : 'Similar number found.'}
                    </p>
                    {onViewExisting && (
                      <button
                        type="button"
                        onClick={() => onViewExisting(dupMatch.contact.id)}
                        className="mt-0.5 underline underline-offset-2 hover:no-underline font-semibold"
                      >
                        View {dupMatch.contact.name || dupMatch.contact.phone}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-400">Include country code, e.g. +91 for India</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="cf-email" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  id="cf-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 mb-2">
                <TagIcon className="h-3.5 w-3.5 text-slate-400" />
                Tags
              </label>
              {loadingTags ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tags…
                </div>
              ) : tags.length === 0 ? (
                <p className="text-[12px] text-slate-400 italic">No tags yet. Create tags in Settings.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition-all"
                        style={{
                          backgroundColor: selected ? tag.color + '22' : '#f8fafc',
                          color: selected ? tag.color : '#64748b',
                          border: `1.5px solid ${selected ? tag.color : '#e2e8f0'}`,
                          boxShadow: selected ? `0 0 0 2px ${tag.color}30` : 'none',
                        }}
                      >
                        {selected && <CheckCircle2 className="h-3 w-3" />}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Footer — sticky */}
          <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || checkingDup || (!isEdit && !!dupMatch?.exact)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
