'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  UsersRound, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Copy, PhoneOff, MessageSquareOff, Wrench,
} from 'lucide-react';
import { AiButton, AiCard, AiCardHeader, AiBadge, AiNotice, AiHint, AiIconTile } from './ui-kit';

/**
 * Contact save & sync check.
 *
 * Everything the AI does about a customer rests on one assumption: that
 * a person is one contact row, linked to their conversations. When that
 * breaks it breaks silently — a duplicate splits someone's history so
 * the assistant "forgets" them, an unnormalized number stops matching on
 * the next inbound message. This surfaces those conditions instead of
 * leaving them to be noticed as odd replies months later.
 *
 * Read-only by design: it names what it found and points at the existing
 * reviewed merge flow. Silently merging two people because their numbers
 * looked alike is not something to automate on real customer data.
 */

interface SyncCheck {
  checked_at: string;
  scanned: number;
  scan_capped: boolean;
  totals: { contacts: number; merged_away: number; opted_in: number; conversations: number };
  by_channel: Record<string, number>;
  findings: {
    duplicate_groups: number;
    duplicate_examples: Array<{ phone: string; count: number; names: string[] }>;
    missing_normalized_phone: number;
    contacts_without_conversation: number;
    orphaned_conversations: number;
  };
  healthy: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Messenger',
  rcs: 'RCS',
  email: 'Email',
  sms: 'SMS',
};

export function ContactSyncPanel() {
  const [data, setData] = useState<SyncCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState('');
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/contacts/sync-check');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not run the check.');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the check.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  async function repairNormalization() {
    setRepairing(true);
    setRepairResult('');
    try {
      const res = await fetch('/api/contacts/sync-check', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not repair.');
      setRepairResult(json.message);
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not repair.');
    } finally {
      setRepairing(false);
    }
  }

  const f = data?.findings;

  return (
    <AiCard className="p-5">
      <AiCardHeader
        title={
          <span className="flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-slate-400" />
            Contact save &amp; sync
          </span>
        }
        subtitle="Checks that each customer is one record, linked to their chats."
        action={
          <AiButton tone="outline" size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-check
          </AiButton>
        }
      />

      {error && <AiNotice tone="error" className="mt-3">{error}</AiNotice>}

      {loading && !data && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[#5B6CF9]" />
        </div>
      )}

      {data && f && (
        <div className="mt-4 space-y-4">
          {data.healthy ? (
            <AiNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
              {data.totals.contacts.toLocaleString()} contacts across{' '}
              {data.totals.conversations.toLocaleString()} conversations — no duplicates or unlinked records found.
            </AiNotice>
          ) : (
            <AiNotice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
              Found things worth looking at. Nothing is changed automatically — merging two contacts is a decision, so
              it stays with you.
            </AiNotice>
          )}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: 'Contacts', value: data.totals.contacts },
              { label: 'Conversations', value: data.totals.conversations },
              { label: 'Opted in', value: data.totals.opted_in },
              { label: 'Merged away', value: data.totals.merged_away },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="mt-0.5 text-[17px] font-bold tabular-nums text-slate-900">
                  {s.value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {Object.keys(data.by_channel).length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-slate-600">Conversations by channel</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(data.by_channel)
                  .sort((a, b) => b[1] - a[1])
                  .map(([channel, count]) => (
                    <AiBadge key={channel} tone="slate">
                      {CHANNEL_LABEL[channel] ?? channel}
                      <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
                    </AiBadge>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Finding
              Icon={Copy}
              tone={f.duplicate_groups > 0 ? 'warn' : 'ok'}
              label="Possible duplicate contacts"
              value={f.duplicate_groups}
              detail={
                f.duplicate_groups > 0
                  ? 'The same person saved twice splits their history, so the AI sees only half of it. Review and merge from Contacts.'
                  : 'Every contact resolves to one person.'
              }
            />
            <Finding
              Icon={PhoneOff}
              tone={f.missing_normalized_phone > 0 ? 'warn' : 'ok'}
              label="Phone numbers not normalized"
              value={f.missing_normalized_phone}
              detail={
                f.missing_normalized_phone > 0
                  ? "These may not match when the customer messages again, creating a second contact instead of continuing the first."
                  : 'All numbers are stored in a matchable form.'
              }
            />
            {f.duplicate_examples.length > 0 && (
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                <p className="text-[11.5px] font-medium text-slate-600">
                  Examples{f.duplicate_groups > f.duplicate_examples.length
                    ? ` (${f.duplicate_examples.length} of ${f.duplicate_groups})`
                    : ''}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {f.duplicate_examples.map((d) => (
                    <li key={d.phone} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="font-mono text-slate-700">{d.phone}</span>
                      <span className="text-slate-500">{d.names.join(' · ')}</span>
                      <span className="text-slate-400">×{d.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.missing_normalized_phone > 0 && (
              <div className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-500/15">
                <p className="text-[12px] leading-relaxed text-amber-900">
                  Normalizing these is safe and automatic — it only rewrites the stored number into a matchable form.
                  Duplicates are left for you, because deciding two records are the same person isn&apos;t something to
                  automate on real customer data.
                </p>
                <AiButton tone="outline" size="sm" onClick={repairNormalization} disabled={repairing} className="mt-2.5">
                  {repairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                  Normalize {f.missing_normalized_phone.toLocaleString()} numbers
                </AiButton>
              </div>
            )}
            {repairResult && <AiNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>{repairResult}</AiNotice>}
            <Finding
              Icon={MessageSquareOff}
              tone="info"
              label="Contacts with no conversation yet"
              value={f.contacts_without_conversation}
              detail="Normal for imported or manually added contacts who have never messaged."
            />
            {f.orphaned_conversations > 0 && (
              <Finding
                Icon={AlertTriangle}
                tone="warn"
                label="Conversations with a missing contact"
                value={f.orphaned_conversations}
                detail="A conversation outlived its contact record. The merge flow soft-deletes to prevent this, so it usually means a direct database edit."
              />
            )}
          </div>

          <AiHint>
            Checked {new Date(data.checked_at).toLocaleString()} · scanned {data.scanned.toLocaleString()} contacts
            {data.scan_capped ? ' (most recent — counts above are exact)' : ''}.
          </AiHint>
        </div>
      )}
    </AiCard>
  );
}

function Finding({
  Icon,
  tone,
  label,
  value,
  detail,
}: {
  Icon: typeof Copy;
  tone: 'ok' | 'warn' | 'info';
  label: string;
  value: number;
  detail: string;
}) {
  const tint = tone === 'warn' ? 'amber' : tone === 'ok' ? 'emerald' : 'slate';
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
      <AiIconTile tint={tint} size="sm">
        <Icon className="h-4 w-4" />
      </AiIconTile>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[12.5px] font-medium text-slate-800">{label}</p>
          <p className="shrink-0 text-[13px] font-bold tabular-nums text-slate-900">{value.toLocaleString()}</p>
        </div>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
