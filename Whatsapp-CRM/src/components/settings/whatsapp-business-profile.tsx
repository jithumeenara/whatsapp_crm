'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ExternalLink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BusinessProfilePreview } from '@/components/settings/business-profile-preview';

const VERTICAL_LABELS: Record<string, string> = {
  UNDEFINED: 'Not specified', OTHER: 'Other', AUTO: 'Automotive', BEAUTY: 'Beauty, Spa & Salon',
  APPAREL: 'Clothing & Apparel', EDU: 'Education', ENTERTAIN: 'Entertainment', EVENT_PLAN: 'Event Planning',
  FINANCE: 'Finance & Banking', GROCERY: 'Grocery', GOVT: 'Government', HOTEL: 'Hotel & Lodging',
  HEALTH: 'Medical & Health', NONPROFIT: 'Non-profit', PROF_SERVICES: 'Professional Services',
  RETAIL: 'Shopping & Retail', TRAVEL: 'Travel & Transportation', RESTAURANT: 'Restaurant', NOT_A_BIZ: 'Not a business',
};

interface ProfileData {
  about: string; description: string; address: string; email: string
  websites: string[]; vertical: string; profile_picture_url?: string
}

const EMPTY: ProfileData = { about: '', description: '', address: '', email: '', websites: [], vertical: 'UNDEFINED' };

export function WhatsAppBusinessProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData>(EMPTY);
  const [displayName, setDisplayName] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [website1, setWebsite1] = useState('');
  const [website2, setWebsite2] = useState('');

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/whatsapp/profile');
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error || 'Failed to load business profile'); return; }
      const p = json.profile ?? {};
      setData({
        about: p.about ?? '', description: p.description ?? '', address: p.address ?? '',
        email: p.email ?? '', websites: p.websites ?? [], vertical: p.vertical ?? 'UNDEFINED',
        profile_picture_url: p.profile_picture_url,
      });
      setWebsite1(p.websites?.[0] ?? '');
      setWebsite2(p.websites?.[1] ?? '');
      setDisplayName(json.displayName ?? '');
      setPhoneDisplay(json.phoneDisplay ?? '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onSave() {
    setSaving(true);
    try {
      const websites = [website1, website2].map((w) => w.trim()).filter(Boolean);
      const res = await fetch('/api/whatsapp/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ about: data.about, description: data.description, address: data.address, email: data.email, websites, vertical: data.vertical }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Failed to save'); return; }
      toast.success('Business profile saved');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">Business Profile</h3>
        <p className="text-[12px] text-slate-500 mt-0.5">What customers see when they open a chat with you — synced directly with Meta.</p>
      </div>

      {loadError ? (
        <div className="px-6 py-6 text-[13px] text-amber-700 bg-amber-50">{loadError}</div>
      ) : (
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4 min-w-0">
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                Display name (&quot;{displayName || phoneDisplay}&quot;) and profile photo require Meta&apos;s review and can only be changed in{' '}
                <a href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noopener noreferrer" className="text-[#5B6CF9] hover:underline inline-flex items-center gap-0.5">
                  WhatsApp Manager <ExternalLink className="h-3 w-3" />
                </a>.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">About</Label>
              <Input value={data.about} onChange={(e) => setData({ ...data, about: e.target.value })}
                maxLength={139} placeholder="Hey there! I'm using WhatsApp Business."
                className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              <p className="text-[11px] text-slate-400">{data.about.length}/139</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Description</Label>
              <textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })}
                maxLength={512} rows={3} placeholder="What your business does"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#5B6CF9] focus:ring-2 focus:ring-[#5B6CF9]/20 resize-none" />
              <p className="text-[11px] text-slate-400">{data.description.length}/512</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Address</Label>
                <Input value={data.address} onChange={(e) => setData({ ...data, address: e.target.value })}
                  placeholder="Business address" className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Email</Label>
                <Input value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })}
                  placeholder="business@company.com" className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Website 1</Label>
                <Input value={website1} onChange={(e) => setWebsite1(e.target.value)}
                  placeholder="https://example.com" className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Website 2</Label>
                <Input value={website2} onChange={(e) => setWebsite2(e.target.value)}
                  placeholder="https://example.com" className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Category</Label>
              <select value={data.vertical} onChange={(e) => setData({ ...data, vertical: e.target.value })}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 outline-none transition-all focus:border-[#5B6CF9] focus:ring-2 focus:ring-[#5B6CF9]/20">
                {Object.entries(VERTICAL_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={onSave} disabled={saving} className="h-9 px-5 text-[13px] bg-[#25D366] hover:bg-[#20BD5C] text-white">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Business Profile'}
              </Button>
            </div>
          </div>

          <div className="flex justify-center lg:justify-start">
            <BusinessProfilePreview
              platform="whatsapp"
              photoUrl={data.profile_picture_url}
              name={displayName || phoneDisplay || 'Your business'}
              handle={phoneDisplay}
              bio={data.about || data.description}
              verified
              details={[
                ...(data.address ? [{ icon: 'address' as const, text: data.address }] : []),
                ...(website1 ? [{ icon: 'website' as const, text: website1 }] : []),
                ...(data.email ? [{ icon: 'email' as const, text: data.email }] : []),
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
