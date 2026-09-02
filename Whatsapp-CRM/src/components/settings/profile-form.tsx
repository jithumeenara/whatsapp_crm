'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, Camera, ShieldCheck, Mail, Phone, CheckCircle2, CircleAlert,
  IdCard, User, Copy, Check, Pencil, X, Crown, UserCheck, UserCog, Palette,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SecurityCard } from '@/components/settings/security-card';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppIcon } from '@/components/icons/brand-icons';
import { CountryCodeSelect } from '@/components/shared/country-code-select';
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, splitE164 } from '@/lib/country-codes';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Classic gold, not Tailwind's amber — reads as an actual crown, not just
// another warning-yellow badge.
const GOLD = '#B8860B';

const ROLE_META: Record<string, { label: string; icon: React.ElementType; badgeBg: string; badgeText: string; iconColor?: string }> = {
  owner:      { label: 'Owner',      icon: Crown,      badgeBg: 'bg-amber-50',   badgeText: 'text-amber-800', iconColor: GOLD },
  admin:      { label: 'Admin',      icon: ShieldCheck,badgeBg: 'bg-blue-100',   badgeText: 'text-blue-700' },
  supervisor: { label: 'Supervisor', icon: UserCheck,  badgeBg: 'bg-violet-100', badgeText: 'text-violet-700' },
  agent:      { label: 'Agent',      icon: UserCog,    badgeBg: 'bg-emerald-100',badgeText: 'text-emerald-700' },
};

/** One row in the read-only summary view — icon + label/value on the
 *  left, a verification pill or "Verify" button on the right. */
function InfoRow({ icon: Icon, iconBg, iconColor, label, right, children, expanded }: {
  icon: React.ElementType; iconBg: string; iconColor: string; label: string
  right?: React.ReactNode; children: React.ReactNode; expanded?: React.ReactNode
}) {
  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: iconBg }}>
          <Icon className="h-4 w-4" style={{ color: iconColor }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-slate-400">{label}</p>
          <div className="text-[14px] font-semibold text-slate-800 mt-0.5 truncate">{children}</div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {expanded}
    </div>
  );
}

/** Small verified/not-verified pill for the right side of a row. */
function VerifiedPill({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
      <CheckCircle2 className="h-3 w-3" /> Verified
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-600">
      <CircleAlert className="h-3 w-3" /> Not verified
    </span>
  );
}

export function ProfileForm() {
  const { userId, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

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
      setEditing(false);
      await refreshProfile();
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  function cancelEdit() {
    setEditing(false);
    setPendingAvatar(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRemoveAvatar(false);
    if (profile) {
      setFullName(profile.full_name ?? '');
      const parsed = profile.phone ? splitE164(profile.phone) : null;
      setPhoneIso(parsed?.iso ?? DEFAULT_COUNTRY_ISO);
      setPhoneLocal(parsed?.local ?? '');
    }
  }

  const dirty = !!profile && (
    fullName.trim() !== (profile.full_name ?? '') ||
    pendingAvatar !== null ||
    removeAvatar ||
    phoneDirty
  );

  const roleInfo = ROLE_META[profile?.account_role ?? ''];

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

  function copyUserId() {
    if (!userId) return;
    navigator.clipboard.writeText(userId);
    setIdCopied(true);
    toast.success('User ID copied');
    setTimeout(() => setIdCopied(false), 1500);
  }

  const blobMotion = reduceMotion
    ? {}
    : { animate: { y: [0, -18, 0], x: [0, 12, 0] }, transition: { duration: 7, repeat: Infinity, ease: 'easeInOut' as const } };
  const blobMotion2 = reduceMotion
    ? {}
    : { animate: { y: [0, 14, 0], x: [0, -10, 0] }, transition: { duration: 8.5, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <div className="space-y-5">
      {/* ── Hero Card ── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EEF0FF] via-[#F4F3FD] to-[#ECEAFB] px-6 py-10">
        {/* Decorative background — ambient only, gated by prefers-reduced-motion */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -left-12 -top-12 h-44 w-44 rounded-full bg-white/50 blur-2xl"
            {...blobMotion}
          />
          <motion.div
            className="absolute -right-6 bottom-2 h-24 w-24 rounded-full bg-white/40 blur-xl"
            {...blobMotion2}
          />
          <div className="absolute right-8 top-7 grid grid-cols-5 gap-2 opacity-40">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-[#5B6CF9]" />
            ))}
          </div>
          <svg className="absolute inset-x-0 bottom-0 h-16 w-full opacity-30" preserveAspectRatio="none" viewBox="0 0 400 60">
            <path d="M0 40 Q 100 10 200 35 T 400 30" fill="none" stroke="#5B6CF9" strokeWidth="1" />
          </svg>
        </div>

        <div className="relative flex flex-col items-center text-center">
          {/* No `size` prop here on purpose — Avatar's own size="lg" variant
              (data-[size=lg]:size-10, 40px) was winning the CSS cascade
              over this explicit className, collapsing the whole avatar to
              a sliver behind the camera button. Plain className sizing
              avoids that conflict entirely. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            title="Change photo"
            className="group relative block h-32 w-32 rounded-full"
          >
            <Avatar className="h-32 w-32 ring-4 ring-white shadow-md">
              {currentAvatar ? (
                <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} />
              ) : null}
              <AvatarFallback className="bg-[#5B6CF9] text-white text-5xl font-bold">
                {initial}
              </AvatarFallback>
            </Avatar>
            {/* Hidden until hover — shown only then, per request */}
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Camera className="h-6 w-6 text-white" />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onPickFile}
          />

          <div className="flex items-center gap-1.5 mt-4">
            <h2 className="text-[19px] font-bold text-slate-900 uppercase tracking-tight">
              {profile?.full_name || 'Your Name'}
            </h2>
            {userId && (
              <button type="button" onClick={copyUserId} title="Copy your User ID"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/70 hover:text-slate-600 transition-colors">
                {idCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <p className="text-[13px] text-slate-500 mt-0.5">{profile?.email}</p>

          {roleInfo && (
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold mt-3 ${roleInfo.badgeBg} ${roleInfo.badgeText}`}>
              <roleInfo.icon className="h-3.5 w-3.5" style={roleInfo.iconColor ? { color: roleInfo.iconColor } : undefined} />
              {roleInfo.label}
            </div>
          )}

          {(pendingAvatar || removeAvatar) && (
            <p className="text-[11px] text-[#5B6CF9] mt-3">Photo will be saved with your other changes below.</p>
          )}
        </div>
      </div>

      {/* ── Personal information ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Personal information</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Update your name and contact details.</p>
          </div>
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
              className="h-8 px-3.5 text-[12.5px] border-slate-200 shrink-0"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={cancelEdit}
              disabled={saving}
              className="h-8 px-3.5 text-[12.5px] border-slate-200 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
        </div>

        <form onSubmit={onSubmit}>
          <div className="divide-y divide-slate-100">
            {!editing ? (
              <InfoRow icon={User} iconBg="#EEF0FF" iconColor="#5B6CF9" label="Display name">
                {profile?.full_name || '—'}
              </InfoRow>
            ) : (
              <div className="px-6 py-4 space-y-1.5">
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
            )}

            {!editing ? (
              <InfoRow
                icon={WhatsAppIcon} iconBg="#E9FBF5" iconColor="#22C55E" label="WhatsApp Number"
                right={profile && (
                  profile.phone_verified ? (
                    <VerifiedPill verified />
                  ) : profile.phone && !phoneVerifying ? (
                    <Button type="button" size="sm" onClick={startPhoneVerify} disabled={phoneSending}
                      className="h-7 px-3 text-[11.5px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
                      {phoneSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify'}
                    </Button>
                  ) : !profile.phone ? (
                    <VerifiedPill verified={false} />
                  ) : null
                )}
                expanded={phoneVerifying && (
                  <div className="mt-3 space-y-2 rounded-xl border border-[#5B6CF9]/15 bg-[#EEF0FF]/40 p-3">
                    <p className="text-[12px] font-normal text-slate-500">Code sent via {phoneSentVia === 'whatsapp' ? 'WhatsApp' : 'SMS'}.</p>
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
                      className="text-[11px] font-normal text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
                  </div>
                )}
              >
                {profile?.phone || 'Not set'}
              </InfoRow>
            ) : (
              <div className="px-6 py-4 space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">WhatsApp Number</Label>
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
                {phoneDirty && (
                  <p className="text-[11px] text-amber-600">Save changes to update your number, then verify it.</p>
                )}
                <p className="text-[11px] text-slate-400">Select your country, then enter the number without the country code.</p>
              </div>
            )}

            {/* Email — always read-only, verification is independent of edit mode */}
            <InfoRow
              icon={Mail} iconBg="#EFF8FF" iconColor="#0284C7" label="Email address"
              right={profile && (
                profile.email_verified ? (
                  <VerifiedPill verified />
                ) : emailSent ? (
                  <span className="text-[11px] font-medium text-emerald-600">Link sent</span>
                ) : (
                  <Button type="button" size="sm" onClick={sendVerificationEmail} disabled={emailSending}
                    className="h-7 px-3 text-[11.5px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
                    {emailSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify'}
                  </Button>
                )
              )}
            >
              {profile?.email}
            </InfoRow>
          </div>

          {editing && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <Button
                type="submit"
                disabled={saving || (!dirty) || !profile}
                className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          )}
        </form>

        {!profile && (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500 px-6 py-3 border-t border-slate-100">
            <IdCard className="h-4 w-4" />
            Loading profile…
          </p>
        )}
      </div>

      {/* ── Appearance — moved here from the Settings sidebar, which no
          longer lists it as its own tab ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
            <Palette className="h-4.5 w-4.5 text-[#5B6CF9]" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Appearance</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Choose how the app looks — saved to this device.</p>
          </div>
        </div>
        <div className="px-6 py-5">
          <AppearancePanel />
        </div>
      </div>

      {/* ── Security (Password + 2FA merged) ── */}
      <SecurityCard />

      {/* ── Sessions ── */}
      <SessionsCard />

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-1">
        Your privacy and security are important to us.
      </p>
    </div>
  );
}
