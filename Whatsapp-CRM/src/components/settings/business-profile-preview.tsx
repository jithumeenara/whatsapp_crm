'use client';

import React from 'react';
import { MapPin, Globe, Mail, Phone, Users, BadgeCheck } from 'lucide-react';

export type PreviewPlatform = 'whatsapp' | 'facebook' | 'instagram';

const BAND_GRADIENT: Record<PreviewPlatform, string> = {
  whatsapp: 'from-[#25D366] via-[#20BD5C] to-[#128C7E]',
  facebook: 'from-[#4599FF] via-[#1877F2] to-[#0F5FD1]',
  instagram: 'from-[#FEDA75] via-[#D62976] to-[#4F5BD5]',
};

const AVATAR_RING: Record<PreviewPlatform, string> = {
  whatsapp: 'ring-[#25D366]/20',
  facebook: 'ring-[#1877F2]/20',
  instagram: 'ring-[#D62976]/20',
};

interface DetailRow {
  icon: 'address' | 'website' | 'email' | 'phone' | 'followers';
  text: string;
}

const ICONS: Record<DetailRow['icon'], typeof MapPin> = {
  address: MapPin, website: Globe, email: Mail, phone: Phone, followers: Users,
};

interface Props {
  platform: PreviewPlatform;
  photoUrl?: string;
  /** Bold headline — display name / page name / account name. */
  name: string;
  /** Muted line under the name — phone number, @handle, category. */
  handle?: string;
  bio?: string;
  details?: DetailRow[];
  verified?: boolean;
}

/**
 * A phone-style "how this actually looks to a customer" live preview card,
 * shared by the WhatsApp/Facebook/Instagram business-profile editors —
 * reuses the same gradient-banner + overlapping-avatar language as
 * profile-form.tsx's own hero card, just re-themed per platform, so it
 * reads as part of the same design system rather than a bolted-on widget.
 */
export function BusinessProfilePreview({ platform, photoUrl, name, handle, bio, details, verified }: Props) {
  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <div className="sticky top-4 w-full max-w-[300px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`h-16 bg-gradient-to-r ${BAND_GRADIENT[platform]} relative`}>
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      </div>
      <div className="px-5 pb-5">
        <div className={`-mt-8 mb-2 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-4 ring-white ${AVATAR_RING[platform]} shadow-md`}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={name || 'Profile photo'} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl font-bold text-slate-400">{initial}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <p className="truncate text-[14.5px] font-bold text-slate-900">{name || 'Your business name'}</p>
          {verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#1877F2]" />}
        </div>
        {handle && <p className="truncate text-[12px] text-slate-500">{handle}</p>}

        {bio && <p className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-600">{bio}</p>}

        {details && details.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            {details.map((d, i) => {
              const Icon = ICONS[d.icon];
              return (
                <div key={i} className="flex items-start gap-2 text-[11.5px] text-slate-500">
                  <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
                  <span className="truncate">{d.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
