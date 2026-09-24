"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Braces, Check, ChevronDown, Copy } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ChatbotBuilderNode } from "@/lib/chatbot/types";
import { allVariables, variablesByNode } from "@/lib/chatbot/variables";

async function copy(token: string) {
  try {
    await navigator.clipboard.writeText(token);
    toast.success(`Copied ${token}`);
  } catch {
    toast.error("Could not copy — select the text and copy it by hand");
  }
}

/**
 * Every variable in this chatbot, in every step.
 *
 * Pick a step, then one of the variables that step fills, and copy its
 * placeholder into any text field. "All variables" lists them all at
 * once. Folded by default so it stays out of the way of the step's own
 * settings.
 */
export function VariablePicker({ allNodes, idPrefix }: { allNodes: ChatbotBuilderNode[]; idPrefix: string }) {
  const groups = useMemo(() => variablesByNode(allNodes), [allNodes]);
  const everything = useMemo(() => allVariables(groups), [groups]);
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

  // A step deleted or emptied since it was picked falls back to "choose".
  const group = groups.find((g) => g.id === groupId) ?? null;
  const chosen = group?.vars.find((v) => v.token === token) ?? null;
  const fromSteps = everything.length - (groups.at(-1)?.vars.length ?? 0);

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Braces className="h-3.5 w-3.5 shrink-0 text-teal-600" />
        <span className="flex-1 text-[11px] font-semibold text-teal-800">
          Variables
          <span className="ml-1 font-normal text-teal-600">
            ({fromSteps} from steps + contact details)
          </span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-teal-600 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-teal-100 px-3 pb-3 pt-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${idPrefix}-var-step`} className="mb-1 block text-[10px] font-medium text-slate-600">Step</label>
              <Select value={group ? group.id : "__none__"} onValueChange={(v) => { setGroupId(!v || v === "__none__" ? "" : v); setToken(""); }}>
                <SelectTrigger id={`${idPrefix}-var-step`} className="h-8 w-full bg-white text-xs">
                  <SelectValue placeholder="Choose a step" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-500">Choose a step</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">
                      {g.label} ({g.vars.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor={`${idPrefix}-var-name`} className="mb-1 block text-[10px] font-medium text-slate-600">Variable</label>
              <Select
                value={chosen ? chosen.token : "__none__"}
                onValueChange={(v) => {
                  if (!v || v === "__none__") { setToken(""); return; }
                  setToken(v);
                  void copy(v);
                }}
                disabled={!group}
              >
                <SelectTrigger id={`${idPrefix}-var-name`} className="h-8 w-full bg-white text-xs">
                  <SelectValue placeholder={group ? "Choose a variable" : "Choose a step first"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-500">Choose a variable</SelectItem>
                  {(group?.vars ?? []).map((v) => (
                    <SelectItem key={v.token} value={v.token} className="text-xs font-mono">
                      {v.key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {chosen && (
            <button
              type="button"
              onClick={() => void copy(chosen.token)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-teal-200 bg-white px-2.5 py-1.5 text-left"
              title="Copy"
            >
              <span className="truncate font-mono text-[11px] text-teal-800">{chosen.token}</span>
              <Copy className="h-3.5 w-3.5 shrink-0 text-teal-600" />
            </button>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-medium text-teal-700 hover:underline"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")} />
              All variables ({everything.length})
            </button>
            {showAll && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {everything.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => { void copy(v.token); }}
                    className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 font-mono text-[10px] text-teal-700 hover:bg-teal-50"
                  >
                    {chosen?.token === v.token ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                    {v.token}
                  </button>
                ))}
              </div>
            )}
          </div>

          {fromSteps === 0 && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              No step fills a variable yet. Ask a question (Collect Input), save a button choice, or wait for a
              Flow — its answers will be listed here.
            </p>
          )}
          <p className="text-[10px] text-slate-500">Choosing a variable copies it. Paste it into any message.</p>
        </div>
      )}
    </div>
  );
}
