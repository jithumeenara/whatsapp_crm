"use client";

/**
 * Where Meta actually sends this Flow's data requests.
 *
 * This exists because a Flow can be perfect in every visible way and
 * still show a blank screen to every customer. The endpoint address
 * lives on Meta's side, the Flow Builder's own preview never uses it —
 * that runs from the developer's browser — and nothing in this app read
 * it back. A Flow left pointing at a development tunnel therefore passed
 * every test anyone could think to run and failed for real people, with
 * no error anywhere to explain it.
 *
 * So the address is shown, next to the Save and Publish buttons, where
 * the person who can fix it is already standing.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Link2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EndpointInfo {
  current: string | null;
  expected: string;
  matches: boolean;
  meta_status: string | null;
}

export function EndpointStatus({
  flowId,
  metaFlowId,
}: {
  flowId?: string;
  metaFlowId?: string | null;
}) {
  const [info, setInfo] = useState<EndpointInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);

  const load = useCallback(async () => {
    if (!flowId || !metaFlowId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/endpoint`);
      const data = await res.json();
      // A failure here is not worth a toast on page load — the Flow may
      // simply have no endpoint because it needs none. It is reported
      // only when somebody presses the button.
      setInfo(res.ok ? (data as EndpointInfo) : null);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [flowId, metaFlowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fix = useCallback(async () => {
    if (!flowId) return;
    setFixing(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/endpoint`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Could not update the endpoint");
        return;
      }
      toast.success("Endpoint now points at this server. Publish to send it live.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the endpoint");
    } finally {
      setFixing(false);
    }
  }, [flowId, load]);

  if (!flowId || !metaFlowId) return null;

  if (loading && !info) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Endpoint
      </span>
    );
  }

  if (!info) return null;

  // A Flow with no endpoint at all is a normal, working thing — plenty of
  // Flows are static forms. Only say something when there is an address
  // and it is the wrong one.
  if (!info.current) {
    return (
      <span
        title="This Flow has no endpoint. That is correct for a Flow that collects answers without looking anything up."
        className="flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-medium text-slate-500"
      >
        <Link2 className="h-3 w-3" /> No endpoint
      </span>
    );
  }

  if (info.matches) {
    return (
      <span
        title={info.current}
        className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600"
      >
        <Check className="h-3 w-3" /> Endpoint here
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        title={`Meta sends this Flow's data requests to ${info.current}`}
        className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600"
      >
        <AlertTriangle className="h-3 w-3" /> Endpoint elsewhere
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={fix}
        disabled={fixing}
        title={`Change it to ${info.expected}`}
        className="h-7 gap-1.5 border-amber-500/40 text-xs text-amber-600 hover:bg-amber-500/10"
      >
        {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        Point it here
      </Button>
    </span>
  );
}
