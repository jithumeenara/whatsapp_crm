'use client';

import type { ReactNode, ComponentType } from 'react';

type Method = 'quick' | 'manual';

interface Props {
  icon: ComponentType<{ className?: string }>;
  channelName: string;
  method: Method;
  onMethodChange: (method: Method) => void;
  /** The EmbeddedSignupButton (or an explanatory fallback if the platform
   *  hasn't set up Embedded Signup yet) — shown when Quick Connect is picked. */
  quickConnect: ReactNode;
  /** Unused — the manual credential form lives in the parent (it already
   *  has its own heading), rendered as a sibling below this component once
   *  Manual Connect is picked. Kept only so existing call sites that still
   *  pass `manualConnect={null}` keep compiling. */
  manualConnect?: ReactNode;
  /** Active-tab color — defaults to the app's brand violet; WhatsApp's own
   *  config screen passes its brand green so the picker matches the rest
   *  of that page instead of clashing with it. */
  accentColor?: string;
}

/**
 * A compact, single-line Quick Connect / Manual Connect picker shown above
 * the channel's connect UI. Quick Connect shows its own small hero (icon +
 * "Connect X" + the Embedded Signup button) right below the picker. Manual
 * Connect shows nothing extra here — the existing credential form the
 * parent renders right underneath already has its own heading ("X
 * Messaging" / "Not configured"), so adding a second "Connect X" hero
 * above it just duplicated that heading (reported by the user as "two
 * heads").
 */
export function ConnectChannelScreen({ icon: Icon, channelName, method, onMethodChange, quickConnect, accentColor = '#5B6CF9' }: Props) {
  return (
    <div className="flex flex-col items-center pt-6 pb-2 px-4">
      <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => onMethodChange('quick')}
          style={method === 'quick' ? { color: accentColor } : undefined}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-all ${
            method === 'quick' ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Quick Connect
          <span
            style={method === 'quick' ? { background: `${accentColor}1A`, color: accentColor } : undefined}
            className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${
              method === 'quick' ? '' : 'bg-slate-200 text-slate-500'
            }`}
          >
            Recommended
          </span>
        </button>
        <button
          type="button"
          onClick={() => onMethodChange('manual')}
          style={method === 'manual' ? { color: accentColor } : undefined}
          className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-all ${
            method === 'manual' ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Manual Connect
        </button>
      </div>

      {method === 'quick' && (
        <div className="flex flex-col items-center text-center mt-6 mb-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 mb-3">
            <Icon className="h-6 w-6" />
          </span>
          <h2 className="text-[16px] font-semibold text-slate-900">Connect {channelName}</h2>
          <p className="text-[12.5px] text-slate-500 mt-1 max-w-xs">Log in with Facebook — no tokens to copy, done in under a minute.</p>
          <div className="mt-4">{quickConnect}</div>
        </div>
      )}
    </div>
  );
}
