'use client'

import { useState } from 'react'
import { X, User, Phone, PhoneCall, Mail, Building2, Loader2, Check } from 'lucide-react'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

const GENDER_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'trans', label: 'Trans' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

interface ContactEditModalProps {
  contactId: string
  initialName: string | null
  initialPhone: string
  initialAlternatePhone: string | null
  initialEmail?: string | null
  initialCompany?: string | null
  initialGender?: string | null
  onClose: () => void
  onSaved: (updated: {
    name: string | null
    phone: string
    alternate_phone: string | null
    email: string | null
    company: string | null
    gender: string | null
  }) => void
}

export function ContactEditModal({
  contactId,
  initialName,
  initialPhone,
  initialAlternatePhone,
  initialEmail,
  initialCompany,
  initialGender,
  onClose,
  onSaved,
}: ContactEditModalProps) {
  const [name, setName]         = useState(initialName ?? '')
  const [phone, setPhone]       = useState(initialPhone)
  const [altPhone, setAltPhone] = useState(initialAlternatePhone ?? '')
  const [email, setEmail]       = useState(initialEmail ?? '')
  const [company, setCompany]   = useState(initialCompany ?? '')
  const [gender, setGender]     = useState(initialGender ?? '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [saved, setSaved]       = useState(false)

  async function handleSave() {
    if (!phone.trim()) { setError('Phone number is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            name.trim() || null,
          phone:           phone.trim(),
          alternate_phone: altPhone.trim() || null,
          email:           email.trim() || null,
          company:         company.trim() || null,
          gender:          gender || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to save')
      }
      setSaved(true)
      onSaved({
        name:            name.trim() || null,
        phone:           phone.trim(),
        alternate_phone: altPhone.trim() || null,
        email:           email.trim() || null,
        company:         company.trim() || null,
        gender:          gender || null,
      })
      setTimeout(onClose, 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] text-slate-800 placeholder-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
            <User className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-slate-900">Edit Contact</p>
            <p className="text-[11px] text-slate-500">Update contact information</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 overflow-y-auto max-h-[70vh]">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1"><User className="h-3 w-3" /> Name</span>
            </label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Contact name" className={fieldCls} />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Gender</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)}
              className={cn(fieldCls, "appearance-none bg-white")}>
              {GENDER_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> Phone Number</span>
            </label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 919526218159" className={fieldCls} />
          </div>

          {/* Alternate Phone */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1"><PhoneCall className="h-3 w-3" /> Alternate Phone</span>
            </label>
            <input type="tel" value={altPhone} onChange={(e) => setAltPhone(e.target.value)}
              placeholder="Optional alternate number" className={fieldCls} />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> Email</span>
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com" className={fieldCls} />
          </div>

          {/* Company */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Company</span>
            </label>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Corp" className={fieldCls} />
          </div>

          {error && (
            <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/60 shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || saved}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white transition-colors',
              saved ? 'bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60',
            )}>
            {saved ? <><Check className="h-4 w-4" /> Saved</>
              : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
