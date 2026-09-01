'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, CircleAlert, Camera, ShieldCheck, Mail, BadgeCheck, Phone, CheckCircle2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PasswordForm } from '@/components/settings/password-form';
import { MfaSettings } from '@/components/settings/mfa-settings';
import { SessionsCard } from '@/components/settings/sessions-card';
import { CountryCodeSelect } from '@/components/shared/country-code-select';
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, splitE164 } from '@/lib/country-codes';

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

  // WhatsApp number — two-part control (country + local), like signup.
  const [phoneIso, setPhoneIso] = useState(DEFAULT_COUNTRY_ISO);
  const [phoneLocal, setPhoneLocal] = useState('');

  // Phone verify (WhatsApp/SMS OTP) — same challenge lifecycle as MFA enroll.
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneConfirming, setPhoneConfirming] = useState(false);
  const [phoneSentVia, setPhoneSentVia] = useState<'sms' | 'whatsapp' | null>(null);

  // Email verify (one-click link).
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    const parsed = profile.phone ? splitE164(profile.phone) : null;
    setPhoneIso(parsed?.iso ?? DEFAULT_COUNTRY_ISO);
    setPhoneLocal(parsed?.local ?? '');
  }, [profile]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const currentAvatar = previewUrl ?? (!removeAvatar ? profile?.avatar_url ?? null : null);
  const initial = (fullName || profile?.full_name || profile?.email || 'U').charAt(0).toUpperCase();

  const combinedPhone = (() => {
    const dial = COUNTRY_CODES.find((c) => c.iso === phoneIso)?.dial ?? '';
    const digits = phoneLocal.replace(/\D/g, '');
    return digits ? `${dial}${digits}` : '';
  })();
  const phoneDirty = !!profile && combinedPhone !== (profile.phone ?? '');

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
      if (phoneDirty) patchBody.phone = combinedPhone;

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
    removeAvatar ||
    phoneDirty
  );

  const roleInfo = ROLE_LABELS[profile?.account_role ?? ''];

  async function startPhoneVerify() {
    setPhoneSending(true);
    try {
      const res = await fetch('/api/account/profile/phone/verify/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to send code'); return; }
      if (data.alreadyVerified) { toast.success('Already verified'); await refreshProfile(); return; }
      setPhoneChallengeId(data.challengeId);
      setPhoneSentVia((data.method as 'sms' | 'whatsapp') ?? null);
      setPhoneVerifying(true);
      toast.success('Verification code sent');
    } finally {
      setPhoneSending(false);
    }
  }

  async function confirmPhoneVerify() {
    if (phoneCode.length !== 6) return;
    setPhoneConfirming(true);
    try {
      const res = await fetch('/api/account/profile/phone/verify/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: phoneChallengeId, code: phoneCode }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Incorrect code'); return; }
      toast.success('Number verified');
      setPhoneVerifying(false);
      setPhoneCode('');
      setPhoneChallengeId('');
      await refreshProfile();
    } finally {
      setPhoneConfirming(false);
    }
  }

  async function sendVerificationEmail() {
    setEmailSending(true);
    try {
      const res = await fetch('/api/account/profile/email/verify/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to send email'); return; }
      if (data.alreadyVerified) { toast.success('Already verified'); await refreshProfile(); return; }
      setEmailSent(true);
      toast.success('Verification email sent — check your inbox');
    } finally {
      setEmailSending(false);
    }
  }

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

            {/* WhatsApp number */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium text-slate-700">WhatsApp Number</Label>
                {profile && (
                  profile.phone_verified ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                      <CircleAlert className="h-3.5 w-3.5" /> Not verified
                    </span>
                  )
                )}
              </div>
              <div className="flex gap-2">
                <CountryCodeSelect value={phoneIso} onChange={setPhoneIso} className="w-[104px] shrink-0" />
                <div className="relative flex-1">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phoneLocal}
                    onChange={(e) => setPhoneLocal(e.target.value)}
                    disabled={saving}
                    className="h-9 pl-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
                  />
                </div>
              </div>
              {phoneDirty ? (
                <p className="text-[11px] text-amber-600">Save changes to update your number, then verify it.</p>
              ) : profile?.phone && !profile.phone_verified && !phoneVerifying ? (
                <button type="button" onClick={startPhoneVerify} disabled={phoneSending}
                  className="text-[11.5px] font-medium text-[#5B6CF9] hover:text-[#4a5ce8] disabled:opacity-60">
                  {phoneSending ? 'Sending code…' : 'Verify this number'}
                </button>
              ) : !profile?.phone && !phoneVerifying ? (
                <button type="button" disabled
                  className="text-[11.5px] font-medium text-slate-400 cursor-not-allowed">
                  Add a number above, then verify
                </button>
              ) : null}
              <p className="text-[11px] text-slate-400">Select your country, then enter the number without the country code.</p>
              {phoneVerifying && (
                <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                  <p className="text-[12px] text-slate-500">Code sent via {phoneSentVia === 'whatsapp' ? 'WhatsApp' : 'SMS'}.</p>
                  <div className="flex gap-2">
                    <Input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456" inputMode="numeric" maxLength={6}
                      className="h-9 text-[13px] font-mono border-slate-200 bg-white text-center tracking-[0.3em]" />
                    <Button type="button" onClick={confirmPhoneVerify} disabled={phoneConfirming || phoneCode.length !== 6}
                      className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                      {phoneConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                    </Button>
                  </div>
                  <button type="button" onClick={() => { setPhoneVerifying(false); setPhoneCode(''); setPhoneChallengeId(''); }}
                    className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
                </div>
              )}
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium text-slate-700">Email address</Label>
                {profile && (
                  profile.email_verified ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                      <CircleAlert className="h-3.5 w-3.5" /> Not verified
                    </span>
                  )
                )}
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={profile?.email ?? ''}
                  disabled
                  className="h-9 pl-9 text-[13px] bg-slate-50 border-slate-200 text-slate-500"
                />
              </div>
              {profile && !profile.email_verified && (
                emailSent ? (
                  <p className="text-[11px] text-emerald-600">Verification link sent — check your inbox (valid 24 hours).</p>
                ) : (
                  <button type="button" onClick={sendVerificationEmail} disabled={emailSending}
                    className="text-[11.5px] font-medium text-[#5B6CF9] hover:text-[#4a5ce8] disabled:opacity-60">
                    {emailSending ? 'Sending…' : 'Send verification email'}
                  </button>
                )
              )}
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

      {/* ── Security (MFA) section ── */}
      <MfaSettings />

      {/* ── Sessions ── */}
      <SessionsCard />
    </div>
  );
}
