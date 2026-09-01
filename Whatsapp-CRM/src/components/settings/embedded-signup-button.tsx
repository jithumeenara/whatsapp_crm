'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        opts: { config_id: string; response_type: string; override_default_response_type: boolean; extras?: Record<string, unknown> },
      ) => void;
    };
  }
}

const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const FB_API_VERSION = 'v21.0'; // matches META_API_VERSION in meta-api.ts

interface Props {
  onConnected?: () => void;
  className?: string;
}

/**
 * The "Connect with Facebook" button — WhatsApp Embedded Signup. Renders
 * nothing until /api/platform/meta-config/public confirms the platform's
 * one Meta App is actually configured (until then, the manual-entry form
 * below it is the only path — this button just doesn't appear).
 *
 * Two async signals have to both arrive before the flow can finish:
 *   - `code`, from FB.login()'s own callback
 *   - `waba_id`/`phone_number_id`, from a separate postMessage event Meta
 *     fires into this window mid-flow
 * They can arrive in either order, so both are stashed in a ref and
 * tryFinish() only actually calls the backend once all three are present.
 */
export function EmbeddedSignupButton({ onConnected, className }: Props) {
  const [ready, setReady] = useState(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const appIdRef = useRef('');
  const configIdRef = useRef('');
  const signupData = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const finishing = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/platform/meta-config/public');
        const data = await res.json();
        if (data.configured) {
          appIdRef.current = data.appId;
          configIdRef.current = data.configId;
          setPlatformConfigured(true);
        } else {
          setPlatformConfigured(false);
        }
      } catch {
        setPlatformConfigured(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!platformConfigured) return;
    if (window.FB) { setReady(true); return; }

    window.fbAsyncInit = () => {
      window.FB!.init({ appId: appIdRef.current, autoLogAppEvents: true, xfbml: true, version: FB_API_VERSION });
      setReady(true);
    };

    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = FB_SDK_SRC;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      document.body.appendChild(script);
    }
  }, [platformConfigured]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com')) return;
      let parsed: { type?: string; data?: { waba_id?: string; phone_number_id?: string } } | null = null;
      try { parsed = JSON.parse(event.data); } catch { return; }
      // Meta documents the completion event as `event: "FINISH"` but notes
      // variants exist — match on the two IDs actually being present
      // instead of pinning to one exact event string.
      if (parsed?.type === 'WA_EMBEDDED_SIGNUP' && parsed.data?.waba_id && parsed.data?.phone_number_id) {
        signupData.current.wabaId = parsed.data.waba_id;
        signupData.current.phoneNumberId = parsed.data.phone_number_id;
        void tryFinish();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tryFinish() {
    const { code, wabaId, phoneNumberId } = signupData.current;
    if (!code || !wabaId || !phoneNumberId || finishing.current) return;
    finishing.current = true;
    setConnecting(true);
    try {
      const res = await fetch('/api/meta/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to finish connecting'); return; }

      // Report every channel that actually got connected — Page/Instagram
      // only show up if the platform's Meta App Configuration granted
      // those assets too, not just WhatsApp.
      const connected = [`WhatsApp (${data.phoneDisplay || 'connected'})`];
      if (data.facebookConnected) connected.push(`Facebook Page (${data.pageName})`);
      if (data.instagramConnected) connected.push(`Instagram (@${data.igUsername})`);
      toast.success(`Connected — ${connected.join(', ')}`);
      onConnected?.();
    } finally {
      setConnecting(false);
      finishing.current = false;
      signupData.current = {};
    }
  }

  function startSignup() {
    if (!window.FB || !configIdRef.current) return;
    signupData.current = {};
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) { toast.error('Facebook signup was cancelled or did not complete'); return; }
        signupData.current.code = code;
        void tryFinish();
      },
      { config_id: configIdRef.current, response_type: 'code', override_default_response_type: true, extras: { setup: {} } },
    );
  }

  if (!platformConfigured) return null;

  return (
    <Button
      type="button"
      onClick={startSignup}
      disabled={!ready || connecting}
      className={className ?? 'h-11 px-5 text-[14px] font-semibold bg-[#1877F2] hover:bg-[#166FE0] text-white'}
    >
      {connecting ? (
        <><Loader2 className="h-4 w-4 animate-spin" />Connecting…</>
      ) : (
        <><Link2 className="h-4 w-4" />Connect with Facebook</>
      )}
    </Button>
  );
}
