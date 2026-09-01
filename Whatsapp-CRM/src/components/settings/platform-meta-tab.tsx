'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { MetaPlatformConfig } from '@/components/settings/meta-platform-config';

/**
 * A thin wrapper — MetaPlatformConfig owns all the real logic, this just
 * gives it a proper standalone tab (pulled out of being buried at the
 * bottom of WhatsApp settings) with page-level framing to match the rest
 * of Settings.
 */
export function PlatformMetaTab() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <ShieldCheck className="h-5 w-5 text-[#5B6CF9]" />
        </div>
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">Embedded Signup</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            One Meta App for the whole platform — set this up once and every tenant gets a one-click &quot;Connect with Facebook&quot; button on WhatsApp, Facebook, and Instagram.
          </p>
        </div>
      </div>

      <MetaPlatformConfig defaultOpen />
    </div>
  );
}
