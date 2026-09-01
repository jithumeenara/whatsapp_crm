'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BusinessProfilePreview } from '@/components/settings/business-profile-preview';

interface ProfileData {
  name: string; about: string; description: string; website: string; phone: string; email: string; pictureUrl: string
}

const EMPTY: ProfileData = { name: '', about: '', description: '', website: '', phone: '', email: '', pictureUrl: '' };

export function FacebookBusinessProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData>(EMPTY);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/facebook/profile');
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error || 'Failed to load Page profile'); return; }
      setData({
        name: json.name ?? '', about: json.about ?? '', description: json.description ?? '',
        website: json.website ?? '', phone: json.phone ?? '', email: json.email ?? '', pictureUrl: json.pictureUrl ?? '',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/facebook/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ about: data.about, description: data.description, website: data.website, phone: data.phone }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Failed to save'); return; }
      toast.success('Page profile saved');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast.error('Use PNG, JPG, or WebP.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Maximum 5 MB.'); return; }

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/facebook/profile/photo', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Failed to update photo'); return; }
      toast.success('Page photo updated');
      await load();
    } finally {
      setUploadingPhoto(false);
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
        <h3 className="text-[14px] font-semibold text-slate-800">Page Profile</h3>
        <p className="text-[12px] text-slate-500 mt-0.5">Your Facebook Page&apos;s public info — synced directly with Meta.</p>
      </div>

      {loadError ? (
        <div className="px-6 py-6 text-[13px] text-amber-700 bg-amber-50">{loadError}</div>
      ) : (
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4 min-w-0">
            <div className="flex items-center gap-3">
              <div className="relative group h-14 w-14 shrink-0">
                <div className="h-14 w-14 rounded-full bg-slate-100 overflow-hidden ring-2 ring-slate-200">
                  {data.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.pictureUrl} alt={data.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-lg font-bold text-slate-400">
                      {(data.name || '?').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  {uploadingPhoto ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
                </button>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickPhoto} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-slate-800">{data.name || 'Your Page'}</p>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
                  className="text-[11.5px] text-[#1877F2] hover:underline disabled:opacity-60">
                  {uploadingPhoto ? 'Uploading…' : 'Change photo'}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">About</Label>
              <Input value={data.about} onChange={(e) => setData({ ...data, about: e.target.value })}
                placeholder="A short line about your Page"
                className="h-9 text-[13px] border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]/20" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Description</Label>
              <textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })}
                rows={3} placeholder="What your business does"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/20 resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Website</Label>
                <Input value={data.website} onChange={(e) => setData({ ...data, website: e.target.value })}
                  placeholder="https://example.com" className="h-9 text-[13px] border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Phone</Label>
                <Input value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })}
                  placeholder="+91 98765 43210" className="h-9 text-[13px] border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]/20" />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={onSave} disabled={saving} className="h-9 px-5 text-[13px] bg-[#1877F2] hover:bg-[#166FE0] text-white">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Page Profile'}
              </Button>
            </div>
          </div>

          <div className="flex justify-center lg:justify-start">
            <BusinessProfilePreview
              platform="facebook"
              photoUrl={data.pictureUrl}
              name={data.name || 'Your Page'}
              handle="Facebook Page"
              bio={data.about || data.description}
              verified
              details={[
                ...(data.website ? [{ icon: 'website' as const, text: data.website }] : []),
                ...(data.phone ? [{ icon: 'phone' as const, text: data.phone }] : []),
                ...(data.email ? [{ icon: 'email' as const, text: data.email }] : []),
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
