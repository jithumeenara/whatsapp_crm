'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, CircleAlert, Camera, ShieldCheck, Mail, BadgeCheck } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PasswordForm } from '@/components/settings/password-form';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner:      { label: 'Owner',      color: 'bg-violet-100 text-violet-700' },
  admin:      { label: 'Admin',      color: 'bg-blue-100 text-blue-700' },
  supervisor: { label: 'Supervisor', color: 'bg-amber-100 text-amber-700' },
  agent:      { label: 'Agent',      color: 'bg-emerald-100 text-emerald-700' },
};

export function ProfileForm() {
  const { userId, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
  }, [profile]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const currentAvatar = previewUrl ?? (!removeAvatar ? profile?.avatar_url ?? null : null);
  const initial = (fullName || profile?.full_name || profile?.email || 'U').charAt(0).toUpperCase();

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) { toast.error('Use PNG, JPG, WebP, or GIF.'); return; }
    if (file.size > MAX_AVATAR_BYTES) { toast.error('Maximum 2 MB.'); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !profile) return;
    const trimmedName = fullName.trim();
    if (!trimmedName) { toast.error('Display name is required'); return; }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null | undefined = undefined;

      if (pendingAvatar) {
        const formData = new FormData();
        formData.append('file', pendingAvatar);
        formData.append('bucket', 'avatars');
        formData.append('path', `${userId}/avatar-${Date.now()}.${pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png'}`);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) {
          const uploadData = await uploadRes.json();
          throw new Error(`Upload failed: ${uploadData.error || uploadRes.status}`);
        }
        const uploadData = await uploadRes.json();
        nextAvatarUrl = uploadData.url ?? uploadData.publicUrl ?? null;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      const patchBody: Record<string, unknown> = { full_name: trimmedName };
      if (nextAvatarUrl !== undefined) patchBody.avatar_url = nextAvatarUrl;

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Save failed: HTTP ${res.status}`);
      }

      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!profile && (
    fullName.trim() !== (profile.full_name ?? '') ||
    pendingAvatar !== null ||
    removeAvatar
  );

  const roleInfo = ROLE_LABELS[profile?.account_role ?? ''];

  return (
    <div className="space-y-5">
      {/* ── Hero Card ── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Gradient banner */}
        <div className="h-24 bg-gradient-to-r from-[#5B6CF9] via-[#7C6CF9] to-[#9B6CF9] relative">
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        </div>

        {/* Avatar + name row */}
        <div className="px-6 pb-5">
          <div className="flex items-end justify-between -mt-10 mb-4">
            {/* Avatar with upload overlay */}
            <div className="relative group">
              <Avatar size="lg" className="h-20 w-20 ring-4 ring-white shadow-md">
                {currentAvatar ? (
                  <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} />
                ) : null}
                <AvatarFallback className="bg-[#5B6CF9] text-white text-2xl font-bold">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={saving}
              >
                <Camera className="h-5 w-5 text-white" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
            </div>

            {/* Role badge */}
            {roleInfo && (
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${roleInfo.color}`}>
                <ShieldCheck className="h-3.5 w-3.5" />
                {roleInfo.label}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg font-bold text-slate-800 leading-tight">
              {profile?.full_name || 'Your Name'}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">{profile?.email}</p>
          </div>

          {/* Avatar actions */}
          <div className="flex gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              className="text-[12px] h-8 border-slate-200"
            >
              <Upload className="h-3.5 w-3.5" />
              {currentAvatar ? 'Change photo' : 'Upload photo'}
            </Button>
            {currentAvatar && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemoveAvatar}
                disabled={saving}
                className="text-[12px] h-8 text-slate-500 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">PNG, JPG, WebP, or GIF · max 2 MB</p>
        </div>
      </div>

      {/* ── Edit form ── */}
      <form onSubmit={onSubmit}>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-[14px] font-semibold text-slate-800">Personal information</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Update your name and display preferences.</p>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Display name */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-full-name" className="text-[13px] font-medium text-slate-700">
                Display name
              </Label>
              <Input
                id="profile-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ada Lovelace"
                maxLength={120}
                disabled={saving}
                required
                className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
              />
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={profile?.email ?? ''}
                  disabled
                  className="h-9 pl-9 text-[13px] bg-slate-50 border-slate-200 text-slate-500"
                />
              </div>
              <p className="text-[11px] text-slate-400">Managed by your authentication provider.</p>
            </div>

            {/* Account info row */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Role</p>
                <div className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 text-[#5B6CF9]" />
                  <span className="text-[13px] font-medium text-slate-700 capitalize">
                    {profile?.account_role ?? 'member'}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">User ID</p>
                <p className="truncate font-mono text-[11px] text-slate-500">{userId ?? '—'}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-2xl">
            {!profile && (
              <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                <CircleAlert className="h-4 w-4" />
                Loading profile…
              </p>
            )}
            <div className="ml-auto">
              <Button
                type="submit"
                disabled={saving || !dirty || !profile}
                className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* ── Password section ── */}
      <PasswordForm />
    </div>
  );
}
