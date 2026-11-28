'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isFacebookOrigin } from './facebook-origin';
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { apiFetch, errorText } from '@/lib/api-fetch';

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
const FB_API_VERSION = GRAPH_API_VERSION // the shared Graph API version (src/lib/meta/versions.ts)

interface Props {
  onConnected?: () => void;
  className?: string;
  /** Button text; "Connect WhatsApp" on the WhatsApp card. */
  label?: string;
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
export function EmbeddedSignupButton({ onConnected, className, label = 'Connect with Facebook' }: Props) {
  const [ready, setReady] = useState(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const appIdRef = useRef('');
  const configIdRef = useRef('');
  const signupData = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string; coexistence?: boolean }>({});
  const finishing = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/platform/meta-config/public');
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
      // Blocked by an ad blocker or a strict network: say so, instead of a
      // button that stays greyed out for ever.
      script.onerror = () => toast.error('Could not load Facebook sign-in. Allow connect.facebook.net (ad blocker?) and reload the page.', { duration: 8000 });
      document.body.appendChild(script);
    }
  }, [platformConfigured]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Meta's own pages only. A bare endsWith('facebook.com') also let
      // https://evilfacebook.com (or plain http) post a lookalike event and
      // swap in its own WhatsApp account ids mid-signup.
      if (!isFacebookOrigin(event.origin)) return;
      let parsed: {
        type?: string;
        event?: string;
        data?: { waba_id?: string; phone_number_id?: string; current_step?: string; error_message?: string };
      } | null = null;
      try { parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (parsed?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const ev = parsed.event ?? '';
      const data = parsed.data ?? {};
      if (ev === 'CANCEL') {
        // Closed before the end. Nothing was connected.
        signupData.current = {};
        toast.message('WhatsApp signup was closed before it finished. Nothing was connected.');
        return;
      }
      if (ev === 'ERROR') {
        signupData.current = {};
        toast.error(data.error_message ? `Meta: ${String(data.error_message).slice(0, 200)}` : 'Meta reported an error in the signup. Try again.');
        return;
      }
      // A WhatsApp Business app number ("coexistence"): Meta sends the
      // WABA only; the server finds the app number and skips registration.
      if (ev === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' && data.waba_id) {
        signupData.current.wabaId = data.waba_id;
        signupData.current.coexistence = true;
        void tryFinish();
        return;
      }
      // Meta documents completion as `event: "FINISH"` with variants —
      // match on both ids being present instead of one exact string.
      if (data.waba_id && data.phone_number_id) {
        signupData.current.wabaId = data.waba_id;
        signupData.current.phoneNumberId = data.phone_number_id;
        void tryFinish();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tryFinish() {
    const { code, wabaId, phoneNumberId, coexistence } = signupData.current;
    if (!code || !wabaId || (!phoneNumberId && !coexistence) || finishing.current) return;
    finishing.current = true;
    setConnecting(true);
    try {
      const res = await apiFetch('/api/meta/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coexistence ? { code, wabaId, coexistence: true } : { code, wabaId, phoneNumberId }),
      });
      const data = (await res.json()) as { phoneDisplay?: string; coexistence?: boolean };
      // WhatsApp only: Instagram, Messenger, ads and catalogs have their own Connect buttons.
      toast.success(
        data.coexistence
          ? `WhatsApp Business app number connected${data.phoneDisplay ? ` (${data.phoneDisplay})` : ''}. Keep using the app on your phone too.`
          : `WhatsApp connected${data.phoneDisplay ? ` (${data.phoneDisplay})` : ''}.`,
      );
      onConnected?.();
    } catch (err) {
      console.error('[embedded-signup] finish failed:', err);
      toast.error(errorText(err, 'Could not finish connecting. Try again.'));
    } finally {
      setConnecting(false);
      finishing.current = false;
      signupData.current = {};
    }
  }

  function startSignup() {
    if (!window.FB || !configIdRef.current) return;
    // Meta's SDK refuses to run FB.login() on a plain http:// page (their
    // own policy, not something we control) — on localhost dev this is
    // expected; it works once tested on the live https:// site.
    if (window.location.protocol !== 'https:') {
      toast.error('Facebook login requires HTTPS. This will work once tested on your live https:// site.', { duration: 8000 });
      return;
    }
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
        <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Connecting…</>
      ) : (
        <><Link2 className="h-4 w-4" aria-hidden="true" />{label}</>
      )}
    </Button>
  );
}
