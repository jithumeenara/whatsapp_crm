'use client';

import React, { useState } from 'react';
import { MessageSquare, Mail, Radio, IdCard, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon, FacebookIcon, InstagramIcon } from '@/components/icons/brand-icons';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { InstagramConfig } from '@/components/settings/instagram-config';
import { FacebookConfig } from '@/components/settings/facebook-config';
import { SmsConfig } from '@/components/settings/sms-config';
import { EmailConfig } from '@/components/settings/email-config';
import { RcsConfig } from '@/components/settings/rcs-config';
import { WhatsAppBusinessProfile } from '@/components/settings/whatsapp-business-profile';
import { FacebookBusinessProfile } from '@/components/settings/facebook-business-profile';
import { InstagramBusinessProfile } from '@/components/settings/instagram-business-profile';

type ChannelKey = 'whatsapp' | 'instagram' | 'facebook' | 'sms' | 'email' | 'rcs';

const CHANNELS: { key: ChannelKey; label: string; icon: React.ComponentType<{ className?: string }>; hasProfile: boolean }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon, hasProfile: true },
  { key: 'instagram', label: 'Instagram', icon: InstagramIcon, hasProfile: true },
  { key: 'facebook', label: 'Facebook', icon: FacebookIcon, hasProfile: true },
  { key: 'sms', label: 'SMS', icon: MessageSquare, hasProfile: false },
  { key: 'email', label: 'Email', icon: Mail, hasProfile: false },
  { key: 'rcs', label: 'RCS', icon: Radio, hasProfile: false },
];

const CONFIG_PANELS: Record<ChannelKey, React.ComponentType> = {
  whatsapp: WhatsAppConfig,
  instagram: InstagramConfig,
  facebook: FacebookConfig,
  sms: SmsConfig,
  email: EmailConfig,
  rcs: RcsConfig,
};

const PROFILE_PANELS: Partial<Record<ChannelKey, React.ComponentType>> = {
  whatsapp: WhatsAppBusinessProfile,
  facebook: FacebookBusinessProfile,
  instagram: InstagramBusinessProfile,
};

/**
 * "Channels" — one nav entry, six channels inside. Replaces what used to
 * be six separate top-level Settings tabs. Business Profile is a
 * per-channel button (only for the 3 channels that have one) that swaps
 * this view over to that channel's profile editor, with a Back button.
 *
 * Layout: channel switcher + Business Profile button share one row. The
 * switcher gets `flex-1 min-w-0 overflow-x-auto` so it shrinks/scrolls
 * instead of wrapping to a second line when the button needs its own
 * space — a fixed-width sibling (the button, `shrink-0`) can't force a
 * flex-1+min-w-0 sibling to wrap the way it could without those two
 * classes.
 */
export function ChannelsTab() {
  const [channel, setChannel] = useState<ChannelKey>('whatsapp');
  const [showProfile, setShowProfile] = useState(false);

  function selectChannel(key: ChannelKey) {
    setChannel(key);
    setShowProfile(false);
  }

  const current = CHANNELS.find((c) => c.key === channel)!;
  const ConfigPanel = CONFIG_PANELS[channel];
  const ProfilePanel = PROFILE_PANELS[channel];

  return (
    <div className="space-y-5">
      {/* One row: channel switcher (shrinks + scrolls horizontally if
          needed, never wraps) + Business Profile action, right-aligned */}
      <div className="flex items-center gap-3">
        {/* Desktop/tablet: segmented tab bar — min-w-0 + overflow-x-auto on
            the wrapper is what lets this shrink instead of forcing the
            action button below it onto a second line. */}
        <div className="hidden sm:block flex-1 min-w-0 overflow-x-auto">
          <div className="inline-flex min-w-max rounded-xl border border-slate-200 bg-slate-50 p-1">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const active = channel === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => selectChannel(c.key)}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-all ${
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile: dropdown */}
        <select
          value={channel}
          onChange={(e) => selectChannel(e.target.value as ChannelKey)}
          className="sm:hidden h-10 flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] font-medium text-slate-800 outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10"
        >
          {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>

        {current.hasProfile && (
          showProfile ? (
            <Button type="button" variant="outline" onClick={() => setShowProfile(false)}
              className="h-9 px-4 text-[13px] border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back to {current.label}</span>
              <span className="sm:hidden">Back</span>
            </Button>
          ) : (
            <Button type="button" onClick={() => setShowProfile(true)}
              className="h-9 px-4 text-[13px] font-medium bg-[#EEF0FF] text-[#5B6CF9] hover:bg-[#E2E5FF] border border-[#5B6CF9]/15 shrink-0">
              <IdCard className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Business Profile</span>
              <span className="sm:hidden">Profile</span>
            </Button>
          )
        )}
      </div>

      {showProfile && ProfilePanel ? <ProfilePanel /> : <ConfigPanel />}
    </div>
  );
}
