'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Megaphone, MousePointerClick, FileSpreadsheet, Sparkles, LineChart,
  Clock, ShieldCheck, Link2, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type Provider = 'meta' | 'google';

const META_BLUE = '#0866FF';
const META_BLUE_SOFT = '#EAF2FF';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

/** Two-provider rail — same pill-strip shape as Channels' ChannelRail,
 *  deliberately built to grow: Google Ads sits here already, greyed out,
 *  rather than being bolted on as an afterthought once it's real. */
function ProviderRail({ provider, onSelect }: { provider: Provider; onSelect: (p: Provider) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="flex min-w-max items-center gap-1">
        <button
          type="button"
          onClick={() => onSelect('meta')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
            provider === 'meta' ? 'bg-[#EAF2FF] text-[#0866FF]' : 'text-slate-500 hover:bg-slate-50',
          )}
        >
          <Megaphone className="h-4 w-4" />
          Meta
        </button>
        <button
          type="button"
          disabled
          title="Coming later"
          className="flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-300"
        >
          Google Ads
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">SOON</span>
        </button>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: MousePointerClick,
    title: 'Click-to-WhatsApp attribution',
    body: "Know exactly which ad started every WhatsApp conversation, and report back when it turns into a real lead or a closed deal — not just a click.",
  },
  {
    icon: FileSpreadsheet,
    title: 'Lead Ads, synced automatically',
    body: 'Every Instant Form submission lands in Leads within seconds, mapped to the right fields — no manual export, no missed 90-day retention window.',
  },
  {
    icon: Sparkles,
    title: 'Automatic event detection',
    body: "Meta reads ad-originated conversations and flags leads and sales on its own, so attribution works from day one — before any automation is set up.",
  },
  {
    icon: LineChart,
    title: 'Ad spend, tied to real revenue',
    body: "See what each campaign actually produced in closed deals inside Reports — not just clicks and cost-per-lead.",
  },
];

function MetaAdsOverview() {
  function handleConnect() {
    toast.message('Meta Ads is still in development', {
      description: "It'll connect the same way WhatsApp does — one click, no tokens to paste in. We'll let you know the moment it's ready.",
    });
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EAF2FF] via-[#F3F7FF] to-[#EFF6FF] px-7 py-9">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <span
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-black/5"
            style={{ color: META_BLUE }}
          >
            <Megaphone className="h-9 w-9" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: META_BLUE_SOFT, color: META_BLUE }}>
              <Clock className="h-3 w-3" />
              In development
            </span>
            <h2 className="mt-3 text-[19px] font-bold text-slate-900">Meta Ads</h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-lg">
              Connect Facebook &amp; Instagram advertising to this CRM — Click-to-WhatsApp attribution, Lead Ads sync, and a real ROI dashboard, all from one account.
            </p>
            <Button
              type="button"
              onClick={handleConnect}
              className="mt-4 h-10 px-5 text-[13px] font-semibold text-white"
              style={{ background: META_BLUE }}
            >
              <Link2 className="h-4 w-4" />
              Connect Meta Ads
            </Button>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-[14px] font-semibold text-slate-800">What connecting unlocks</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Everything below runs on Meta&apos;s own APIs — nothing here is a third-party workaround.</p>
        </div>
        <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
                  <f.icon className="h-4 w-4" style={{ color: META_BLUE }} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-800">{f.title}</p>
                  <p className="mt-1 text-[12.5px] text-slate-500 leading-relaxed">{f.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it will connect */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h3 className="text-[14px] font-semibold text-slate-800">How it connects, once it&apos;s live</h3>
        <p className="text-[12px] text-slate-500 mt-0.5 mb-5">The same one-click sign-in already used for WhatsApp — no separate setup process to learn.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: 'One click to sign in', body: 'Log in with Facebook, same popup as WhatsApp Quick Connect.' },
            { icon: CheckCircle2, title: 'Everything auto-discovered', body: 'Ad account, pixel, and Lead Ads forms found automatically — nothing to look up.' },
            { icon: LineChart, title: 'Ready immediately', body: 'Attribution and reporting start working the moment the popup closes.' },
          ].map((step, i) => (
            <div key={step.title} className="relative rounded-xl border border-slate-100 bg-slate-50 p-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-400 ring-1 ring-slate-200 mb-3">{i + 1}</span>
              <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                <step.icon className="h-3.5 w-3.5 text-slate-400" />
                {step.title}
              </p>
              <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoogleAdsComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
        <Megaphone className="h-6 w-6 text-slate-400" />
      </span>
      <p className="text-[14px] font-semibold text-slate-700">Google Ads is coming after Meta Ads</p>
      <p className="max-w-xs text-[12.5px] text-slate-500">
        Same idea — one connection, lead sync, and spend tied to real revenue. Not started yet.
      </p>
    </div>
  );
}

export function AdsTab() {
  const [provider, setProvider] = useState<Provider>('meta');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <ProviderRail provider={provider} onSelect={setProvider} />
      {provider === 'meta' ? <MetaAdsOverview /> : <GoogleAdsComingSoon />}
      <p className="text-center text-[11px] text-slate-400">
        Meta Ads is next up on the roadmap — this page will switch to the real connection automatically once it ships.
      </p>
    </div>
  );
}
