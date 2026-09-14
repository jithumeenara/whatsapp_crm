"use client";

/**
 * Call settings.
 *
 * Ordered by what decides what: whether the assistant answers at all,
 * then who a call goes to, then the things that only matter once calls
 * are actually happening. SIP sits at the bottom behind its own heading
 * because it is stored now and used later, and a setting that does
 * nothing yet has to say so rather than look broken.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Phone, Bot, Users, Loader2, Save, PlugZap, AlertTriangle } from "lucide-react";

type Member = { user_id: string; full_name: string; role: string };

type Config = {
  ai_answer_enabled: boolean;
  ai_greeting: string | null;
  ai_max_minutes: number;
  transfer_strategy: string;
  transfer_only_online: boolean;
  transfer_to: string | null;
  transfer_fallback_to: string | null;
  ring_seconds: number;
  record_calls: boolean;
  call_forward_url: string | null;
  sip_enabled: boolean;
  sip_host: string | null;
  sip_username: string | null;
  sip_from_number: string | null;
  has_sip_password?: boolean;
};

/** Same roles the chatbot transfer step offers — a viewer cannot speak
 *  to a caller any more than they can send a message. */
const TRANSFERABLE_ROLES = ["owner", "supervisor", "admin", "agent"];

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50/70 p-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-800">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function CallsTab() {
  const [config, setConfig] = useState<Config | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [sipPassword, setSipPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cfgRes, memRes] = await Promise.all([
          fetch("/api/call-config"),
          fetch("/api/account/members"),
        ]);
        if (cancelled) return;
        if (cfgRes.ok) setConfig(await cfgRes.json());
        if (memRes.ok) {
          const data = await memRes.json();
          setMembers(
            ((data.members ?? []) as Member[]).filter((m) => TRANSFERABLE_ROLES.includes(m.role)),
          );
        }
      } catch {
        /* the tab renders with defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = useCallback(<K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }, []);

  const save = useCallback(async () => {
    if (!config || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/call-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The password is sent only when a new one was typed — otherwise
        // the field is omitted entirely and the stored one is kept.
        body: JSON.stringify(sipPassword.trim() ? { ...config, sip_password: sipPassword } : config),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? `Could not save (${res.status})`);
        return;
      }
      setConfig(data);
      setSipPassword("");
      toast.success("Call settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save call settings");
    } finally {
      setSaving(false);
    }
  }, [config, saving, sipPassword]);

  if (!config) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading call settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stated once, at the top, rather than discovered by making a
          call and hearing nothing happen. */}
      <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 p-4 text-[12.5px] leading-relaxed text-amber-900 ring-1 ring-amber-500/20">
        <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" />
        <p className="min-w-0">
          <span className="font-semibold">Calls ring, but cannot yet be picked up in the app.</span>{" "}
          Incoming calls are recorded here and ring whoever is available, and everything below
          decides who and for how long. Actually carrying the audio needs one more piece — a media
          connection — which is not built yet. Until it is, a call that nobody takes on their own
          phone lands in the list as missed.
        </p>
      </div>

      <Section
        icon={<Bot className="h-4 w-4" />}
        title="The assistant on calls"
        subtitle="Whether the assistant answers a call the way it answers a message."
      >
        <Row
          label="Let the assistant answer calls"
          hint="Off, every call rings a person. This stays off until the media connection exists — turning it on now records the intention, nothing more."
        >
          <Switch
            checked={config.ai_answer_enabled}
            onCheckedChange={(v) => set("ai_answer_enabled", v)}
          />
        </Row>

        <div className="rounded-xl bg-slate-50/70 p-3">
          <p className="text-[13px] font-medium text-slate-800">What it says first</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            Left empty, it opens the way your assistant opens anywhere else. Write it in the
            language your callers use.
          </p>
          <Input
            value={config.ai_greeting ?? ""}
            onChange={(e) => set("ai_greeting", e.target.value)}
            placeholder="Namaskaram, ACSTI Kerala. How can I help?"
            className="mt-2 h-9 text-sm"
          />
        </div>

        <Row
          label="Stop after"
          hint="However well it is going, a caller should not be left with an assistant indefinitely."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={60}
              value={config.ai_max_minutes}
              onChange={(e) => set("ai_max_minutes", Number(e.target.value))}
              className="h-9 w-16 text-center text-sm tabular-nums"
            />
            <span className="text-[12px] text-slate-500">minutes</span>
          </div>
        </Row>
      </Section>

      <Section
        icon={<Users className="h-4 w-4" />}
        title="Who takes the call"
        subtitle="The same choice the chatbot transfer step offers, so calls and chats route the same way."
      >
        <Row label="Send the call to">
          <Select
            value={config.transfer_strategy}
            // This Select can hand back null when cleared; the strategy
            // has no sensible empty state, so clearing falls back to the
            // default rather than storing nothing.
            onValueChange={(v) => set("transfer_strategy", v ?? "least_busy")}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="least_busy">Whoever has the fewest chats</SelectItem>
              <SelectItem value="round_robin">Take it in turns</SelectItem>
              <SelectItem value="specific">One specific person</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        {config.transfer_strategy === "specific" && (
          <Row label="That person">
            <Select
              value={config.transfer_to ?? ""}
              onValueChange={(v) => set("transfer_to", v || null)}
            >
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="Pick someone" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name || m.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}

        <Row
          label="Only ring people who are signed in"
          hint="Counts anyone active in the last 15 minutes."
        >
          <Switch
            checked={config.transfer_only_online}
            onCheckedChange={(v) => set("transfer_only_online", v)}
          />
        </Row>

        <Row
          label="If nobody is available"
          hint="Nobody chosen here means the call is declined immediately rather than ringing into an empty office."
        >
          <Select
            value={config.transfer_fallback_to ?? ""}
            onValueChange={(v) => set("transfer_fallback_to", v || null)}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="Decline the call" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Decline the call</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || m.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label="Ring for" hint="How long an agent's screen rings before the call counts as missed.">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={120}
              value={config.ring_seconds}
              onChange={(e) => set("ring_seconds", Number(e.target.value))}
              className="h-9 w-16 text-center text-sm tabular-nums"
            />
            <span className="text-[12px] text-slate-500">seconds</span>
          </div>
        </Row>
      </Section>

      <Section
        icon={<Phone className="h-4 w-4" />}
        title="Recording"
        subtitle="Off until you turn it on, because recording someone is their decision as much as yours."
      >
        <Row
          label="Record calls"
          hint="Recording a caller without telling them is unlawful in most places. Whatever your greeting says, it has to say this too."
        >
          <Switch checked={config.record_calls} onCheckedChange={(v) => set("record_calls", v)} />
        </Row>
      </Section>

      <Section
        icon={<Bot className="h-4 w-4" />}
        title="Voice agent"
        subtitle="Where calls are passed to be answered. Empty means nothing is passed on."
      >
        <div className="rounded-xl bg-slate-50/70 p-3">
          <p className="text-[13px] font-medium text-slate-800">Forward calls to</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            Meta sends every webhook to one address, and this app is it — which must stay true, because
            messages are live. Calls are passed on from here instead. During testing this is your ngrok
            address; later it is wherever the voice agent runs.
          </p>
          <Input
            value={config.call_forward_url ?? ""}
            onChange={(e) => set("call_forward_url", e.target.value)}
            placeholder="https://your-tunnel.ngrok.dev/whatsapp"
            className="mt-2 h-9 text-sm"
          />
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
            The webhook is passed on exactly as Meta sent it, signature and all, so the agent&apos;s own
            security check still passes. Messages never go here — only calls.
          </p>
        </div>
      </Section>

      <Section
        icon={<PlugZap className="h-4 w-4" />}
        title="SIP connection"
        subtitle="Stored now, used later. Nothing reads these yet."
      >
        <div className="rounded-xl bg-slate-50/70 p-3 text-[11.5px] leading-relaxed text-slate-600">
          SIP is the other way Meta can deliver calls — to a telephony server instead of to this
          app. It replaces webhooks rather than adding to them, and the App ID cannot be changed
          once saved in WhatsApp Manager, so it is worth settling on a SIP endpoint before
          switching anything over.
        </div>

        <Row label="Use SIP" hint="Has no effect yet.">
          <Switch checked={config.sip_enabled} onCheckedChange={(v) => set("sip_enabled", v)} />
        </Row>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[12px] text-slate-600">SIP server</p>
            <Input
              value={config.sip_host ?? ""}
              onChange={(e) => set("sip_host", e.target.value)}
              placeholder="sip.example.com"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-[12px] text-slate-600">Username</p>
            <Input
              value={config.sip_username ?? ""}
              onChange={(e) => set("sip_username", e.target.value)}
              placeholder="acsti"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-[12px] text-slate-600">Password</p>
            <Input
              type="password"
              value={sipPassword}
              onChange={(e) => setSipPassword(e.target.value)}
              placeholder={config.has_sip_password ? "••••••••" : "Not set"}
              className="h-9 text-sm"
            />
            <p className="mt-1 text-[10.5px] text-slate-400">
              {config.has_sip_password
                ? "Saved. Leave empty to keep it."
                : "Stored encrypted, like every other credential here."}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[12px] text-slate-600">Caller ID</p>
            <Input
              value={config.sip_from_number ?? ""}
              onChange={(e) => set("sip_from_number", e.target.value)}
              placeholder="+91…"
              className="h-9 text-sm"
            />
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save call settings"}
        </Button>
      </div>
    </div>
  );
}
