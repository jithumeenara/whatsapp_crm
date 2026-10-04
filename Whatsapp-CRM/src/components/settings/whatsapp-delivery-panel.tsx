'use client';

/**
 * "Do customer messages actually reach this CRM?" — the answer to the
 * question a green "Connected" badge used to leave open.
 *
 * Reads the delivery report from /api/whatsapp/config/verify-registration
 * (src/lib/whatsapp/webhook-delivery.ts) and says, in plain words, where
 * Meta sends this number's messages and what to do if that is not here.
 * When the fix is one Meta lets us make — pointing this one number at
 * this CRM — it is a button; otherwise the exact steps.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeliveryIssue, DeliveryReport } from '@/lib/whatsapp/webhook-delivery';

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ');
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The "Webhook" tile on Connection health. `ok: null` is neutral. */
export function deliveryTile(report: DeliveryReport | undefined, checking: boolean): { value: string; ok: boolean | null } {
  if (!report) return { value: checking ? 'Checking…' : 'Not checked', ok: null };
  switch (report.status) {
    case 'receiving':
      return { value: 'Receiving', ok: true };
    case 'waiting':
      return { value: 'Waiting for a message', ok: null };
    case 'blocked':
      return { value: 'Not reaching CRM', ok: false };
    default:
      return { value: 'Could not check', ok: false };
  }
}

const SHORT: Record<DeliveryIssue, string> = {
  not_subscribed: 'The WhatsApp account is not subscribed to the CRM’s Meta app.',
  no_callback: 'The Meta app has no webhook address.',
  elsewhere: 'Messages go to another address.',
  messages_off: 'The Meta app is not subscribed to the “messages” field.',
  no_secret: 'This server has no Meta App Secret.',
  secret_mismatch: 'This server’s App Secret is not the sending app’s.',
};

const VIA: Record<string, string> = {
  phone_number: 'That address is set on this phone number.',
  whatsapp_business_account: 'That address is set on the WhatsApp Business account — often left there by a previous provider.',
  application: 'That is the Meta app’s main webhook address — usually because the app is shared with another site.',
};

export function DeliveryPanel({
  report,
  configId,
  onFixed,
}: {
  report: DeliveryReport;
  configId?: string;
  onFixed: () => void;
}) {
  const [fixing, setFixing] = useState(false);

  async function fix() {
    setFixing(true);
    try {
      const res = await fetch('/api/whatsapp/config/webhook-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp_config_id: configId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not change where messages go.', { duration: 10000 });
        return;
      }
      toast.success(
        data.confirmed
          ? 'Done — Meta now sends this number’s messages here. Send a test message to confirm.'
          : 'Sent to Meta. Run the test again in a minute to confirm.',
        { duration: 8000 },
      );
      onFixed();
    } catch {
      toast.error('Could not reach the server — check the connection.');
    } finally {
      setFixing(false);
    }
  }

  const rejectedNote = report.rejected && report.rejected.count > 0 && (
    <p className="text-[11.5px] text-rose-600">
      Since {when(report.since)}, {report.rejected.count} delivery attempt{report.rejected.count === 1 ? '' : 's'} from Meta {report.rejected.count === 1 ? 'was' : 'were'} turned away
      {report.rejected.reason === 'mismatch' ? ' because the signature did not match' : ''} — last at {when(report.rejected.at)}.
    </p>
  );

  if (report.status === 'receiving') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Customer messages are reaching this CRM.</p>
          {report.lastDeliveredAt && <p className="mt-0.5 text-emerald-700">Last delivery from Meta: {when(report.lastDeliveredAt)}.</p>}
        </div>
      </div>
    );
  }

  if (report.status === 'waiting') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] text-slate-700">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <div className="space-y-1.5">
          <p className="font-semibold text-slate-800">Set up correctly — waiting for the first message.</p>
          <p>
            Meta is set to send this number’s messages to this CRM, but none has arrived since the server started ({when(report.since)}).
            Send a WhatsApp message to this number from any phone, wait a few seconds, then run the test again.
          </p>
          <p className="text-[11.5px] text-slate-500">
            Still nothing? In Meta for Developers, check that the app is in <b>Live</b> mode — Meta does not send some webhooks to apps in Development mode.
          </p>
          {rejectedNote}
        </div>
      </div>
    );
  }

  if (report.status === 'unknown') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Could not ask Meta where this number’s messages go.</p>
          {report.routeError && <p className="mt-0.5 break-words">{report.routeError}</p>}
        </div>
      </div>
    );
  }

  const [first, ...rest] = report.issues;
  const appName = report.appName ? `“${report.appName}”` : 'the Meta app that sends these messages';
  const step = 'rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11.5px] break-all';

  return (
    <div className="space-y-2.5 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3.5 text-[12.5px] text-rose-900">
      <div className="flex items-start gap-2.5">
        {first === 'secret_mismatch' || first === 'no_secret'
          ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
        <div className="min-w-0 space-y-1.5">
          {first === 'elsewhere' && (
            <>
              <p className="font-semibold">Customer messages are going to another address, not to this CRM.</p>
              <p>
                Meta sends this number’s messages to <span className={step}>{report.effectiveUrl}</span> — this CRM is{' '}
                <span className={step}>{report.ourUrl}</span>.
              </p>
              {report.via && <p className="text-rose-800">{VIA[report.via]}</p>}
              <p className="text-rose-800">“Send messages here” changes only this number. The Meta app’s main address and other numbers stay as they are.</p>
            </>
          )}
          {first === 'not_subscribed' && (
            <>
              <p className="font-semibold">The WhatsApp account is not subscribed to the CRM’s Meta app.</p>
              <p className="text-rose-800">Without it, Meta sends this number’s messages nowhere this CRM can see.</p>
            </>
          )}
          {first === 'no_callback' && (
            <>
              <p className="font-semibold">Meta has no address to send this number’s messages to.</p>
              <p className="text-rose-800">
                In Meta for Developers → your app → WhatsApp → Configuration, set the Callback URL to <span className={step}>{report.ourUrl}</span>{' '}
                with the verify token saved in Manage Connection, then subscribe to the <b>messages</b> field.
              </p>
            </>
          )}
          {first === 'messages_off' && (
            <>
              <p className="font-semibold">The Meta app is not subscribed to incoming messages.</p>
              <p className="text-rose-800">
                In Meta for Developers → your app → WhatsApp → Configuration → Webhook fields, find <b>messages</b> and press Subscribe.
              </p>
            </>
          )}
          {(first === 'secret_mismatch' || first === 'no_secret') && (
            <>
              <p className="font-semibold">
                {first === 'no_secret'
                  ? 'This server has no Meta App Secret, so it turns every message away.'
                  : 'Meta is sending messages here, but this server cannot confirm they are genuine, so it turns them away.'}
              </p>
              <p className="text-rose-800">
                Whoever manages the server should set <code className={step}>META_APP_SECRET</code> in its <code className={step}>.env</code> to the
                App Secret of {appName} (Meta for Developers → App settings → Basic), then restart the CRM. Never send the secret in a chat or email.
              </p>
              <p className="text-rose-800">Meta keeps retrying for up to 7 days, so messages sent meanwhile still arrive once this is fixed.</p>
            </>
          )}
          {rejectedNote}
          {rest.length > 0 && (
            <ul className="space-y-0.5 pt-0.5 text-[11.5px] text-rose-700">
              {rest.map((i) => <li key={i}>Also: {SHORT[i]}</li>)}
            </ul>
          )}
        </div>
      </div>

      {report.canFix && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button type="button" onClick={fix} disabled={fixing} className="h-9 bg-emerald-600 px-3.5 text-[12.5px] text-white hover:bg-emerald-700">
            {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {first === 'not_subscribed' ? 'Subscribe and send messages here' : 'Send messages here'}
          </Button>
          <span className={cn('text-[11.5px] text-rose-700', fixing && 'opacity-60')}>Admins only. Meta checks this CRM’s address before accepting.</span>
        </div>
      )}
      {!report.canFix && report.effectiveUrl && first !== 'elsewhere' && (
        <p className="pl-6 text-[11.5px] text-rose-700">Meta currently sends this number’s messages to {hostOf(report.effectiveUrl)}.</p>
      )}
    </div>
  );
}
