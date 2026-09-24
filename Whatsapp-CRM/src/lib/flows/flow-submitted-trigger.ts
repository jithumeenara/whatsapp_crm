/**
 * Starting a chatbot when a customer submits a WhatsApp Flow.
 *
 * A Flow sent by a chatbot's own send_flow node is already handled: the
 * run waits on it, and the reply carries the token it minted. A Flow
 * sent inside a *template* — a broadcast, or a template sent from the
 * Inbox — has no run waiting. Its reply arrived, was shown in the Inbox
 * as "Flow submitted", and nothing else happened.
 *
 * A chatbot whose Start node is set to "When a WhatsApp Flow is
 * submitted" picks those up. It is stored as trigger_type 'manual' — the
 * one type that never starts from an ordinary message, and one the
 * database already allows — with `trigger_config.start_on` saying when
 * it does start.
 *
 * Which Flow was filled in: Meta's reply names the message that carried
 * the Flow in `context.id` (developers.facebook.com, "Receive Flow
 * response"). For a template that message is on record with its
 * template name, and the template's FLOW button holds the Flow's id.
 */

import { prisma } from "@/lib/db";

export const FLOW_SUBMITTED = "flow_submitted";

export interface FlowSubmittedCandidate {
  id: string;
  trigger_type: string;
  trigger_config: unknown;
}

/** The chatbot, if any, set to start on this submission.
 *
 *  One tied to this exact Flow wins over one set to "any Flow", so a
 *  catch-all can sit beside specific ones. Earliest-created first
 *  within each, matching how keyword chatbots are chosen. */
export function pickFlowSubmittedChatbot<T extends FlowSubmittedCandidate>(
  flows: T[],
  metaFlowId: string | null,
): T | null {
  let anyFlow: T | null = null;
  for (const f of flows) {
    if (f.trigger_type !== "manual") continue;
    const cfg = (f.trigger_config ?? {}) as Record<string, unknown>;
    if (cfg.start_on !== FLOW_SUBMITTED) continue;
    const wanted = typeof cfg.meta_flow_id === "string" ? cfg.meta_flow_id.trim() : "";
    if (!wanted) {
      anyFlow ??= f;
    } else if (metaFlowId && wanted === metaFlowId) {
      return f;
    }
  }
  return anyFlow;
}

/** Submitted values as chatbot variables, each prefixed `flow_` — the
 *  same names the send_flow node gives them, so {{vars.flow_name}}
 *  means the same thing whichever way the Flow arrived. */
export function flowVarsFromResponse(response: Record<string, unknown>): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    // Keys come from the customer's device. Keep them to plain names
    // so nothing odd ends up addressable as a variable.
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key)) continue;
    vars[`flow_${key}`] = value;
  }
  return vars;
}

/** The Meta Flow id behind the message the customer replied to, found
 *  through its template's FLOW button. Null when it cannot be told —
 *  then only an "any Flow" chatbot matches. */
export async function identifySubmittedFlow(
  accountId: string,
  sourceMessageId: string | null | undefined,
): Promise<string | null> {
  if (!sourceMessageId) return null;
  try {
    const msg = await prisma.message.findFirst({
      where: { id: sourceMessageId, conversation: { account_id: accountId } },
      select: { template_name: true },
    });
    if (!msg?.template_name) return null;
    const templates = await prisma.messageTemplate.findMany({
      where: { account_id: accountId, name: msg.template_name },
      select: { buttons: true },
    });
    for (const t of templates) {
      const buttons = Array.isArray(t.buttons) ? (t.buttons as Array<Record<string, unknown>>) : [];
      const flowButton = buttons.find((b) => b?.type === "FLOW" && typeof b.flow_id === "string" && b.flow_id);
      if (flowButton) return String(flowButton.flow_id);
    }
  } catch (err) {
    console.error("[flows] could not tell which Flow was submitted:", err instanceof Error ? err.message : err);
  }
  return null;
}
