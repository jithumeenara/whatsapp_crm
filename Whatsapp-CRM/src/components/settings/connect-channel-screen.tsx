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
  /** Rendered below the picker when Manual Connect is picked — the
   *  existing credential form each channel already has, untouched. */
  manualConnect: ReactNode;
}

/**
 * The big, centered "let's connect this channel" screen shown in place of
 * the small top banner that used to sit above an always-visible manual
 * form. Two methods, presented as a real radio choice — Quick Connect
 * (Embedded Signup) is the default; Manual Connect reveals the existing
 * credential-entry form underneath instead of replacing this screen.
 */
export function ConnectChannelScreen({ icon: Icon, channelName, method, onMethodChange, quickConnect, manualConnect }: Props) {
  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-7">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
            <Icon className="h-7 w-7" />
          </span>
          <h2 className="text-[17px] font-semibold text-slate-900">Connect {channelName}</h2>
          <p className="text-[13px] text-slate-500 mt-1">Choose how you&apos;d like to connect your account.</p>
        </div>

        <div className="flex flex-col gap-2.5">
          <label
            className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${
              method === 'quick' ? 'border-[#5B6CF9] bg-[#EEF0FF]/50 ring-1 ring-[#5B6CF9]/20' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="connect-method"
              checked={method === 'quick'}
              onChange={() => onMethodChange('quick')}
              className="mt-1 h-4 w-4 accent-[#5B6CF9]"
            />
            <div>
              <p className="text-[13.5px] font-semibold text-slate-800 flex items-center gap-1.5">
                Quick Connect
                <span className="rounded-full bg-[#5B6CF9]/10 px-2 py-0.5 text-[10px] font-medium text-[#5B6CF9]">Recommended</span>
              </p>
              <p className="text-[12px] text-slate-500 mt-0.5">Log in with Facebook — no tokens to copy, done in under a minute.</p>
            </div>
          </label>

          {method === 'quick' && (
            <div className="flex justify-center pt-1 pb-2">{quickConnect}</div>
          )}

          <label
            className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition-all ${
              method === 'manual' ? 'border-[#5B6CF9] bg-[#EEF0FF]/50 ring-1 ring-[#5B6CF9]/20' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="connect-method"
              checked={method === 'manual'}
              onChange={() => onMethodChange('manual')}
              className="mt-1 h-4 w-4 accent-[#5B6CF9]"
            />
            <div>
              <p className="text-[13.5px] font-semibold text-slate-800">Manual Connect</p>
              <p className="text-[12px] text-slate-500 mt-0.5">Paste in your own API credentials from Meta&apos;s developer console.</p>
            </div>
          </label>
        </div>
      </div>

      {method === 'manual' && (
        <div className="w-full max-w-2xl mt-6">{manualConnect}</div>
      )}
    </div>
  );
}
