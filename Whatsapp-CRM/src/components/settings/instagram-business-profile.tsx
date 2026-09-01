'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, Info } from 'lucide-react';
import { BusinessProfilePreview } from '@/components/settings/business-profile-preview';

interface ProfileData {
  username: string; name: string; biography: string; profilePictureUrl: string; followersCount: number | null
}

const EMPTY: ProfileData = { username: '', name: '', biography: '', profilePictureUrl: '', followersCount: null };

/**
 * Read-only — Meta's Graph API has no write endpoint for an Instagram
 * professional account's bio/name/photo (see /api/instagram/profile).
 * This just shows the live profile and links out to where it CAN be edited.
 */
export function InstagramBusinessProfile() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData>(EMPTY);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/instagram/profile');
        const json = await res.json();
        if (!res.ok) { setLoadError(json.error || 'Failed to load Instagram profile'); return; }
        setData(json);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        <p className="text-[12px] text-slate-500 mt-0.5">A live look at your Instagram profile.</p>
      </div>

      {loadError ? (
        <div className="px-6 py-6 text-[13px] text-amber-700 bg-amber-50">{loadError}</div>
      ) : (
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="space-y-4 min-w-0">
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                Instagram doesn&apos;t let apps change your name, bio, or photo — Meta only allows that from inside the Instagram app itself or Business Suite. This is a live, view-only preview.
              </p>
            </div>

            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Username</span>
                <span className="font-medium text-slate-800">@{data.username || '—'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Name</span>
                <span className="font-medium text-slate-800">{data.name || '—'}</span>
              </div>
              {data.followersCount !== null && (
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Followers</span>
                  <span className="font-medium text-slate-800">{data.followersCount.toLocaleString()}</span>
                </div>
              )}
            </div>

            {data.username && (
              <a href={`https://www.instagram.com/${data.username}/`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D62976] hover:underline">
                Edit on Instagram <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="flex justify-center lg:justify-start">
            <BusinessProfilePreview
              platform="instagram"
              photoUrl={data.profilePictureUrl}
              name={data.name || data.username || 'Your account'}
              handle={data.username ? `@${data.username}` : undefined}
              bio={data.biography}
              details={data.followersCount !== null ? [{ icon: 'followers', text: `${data.followersCount.toLocaleString()} followers` }] : []}
            />
          </div>
        </div>
      )}
    </div>
  );
}
