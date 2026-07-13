/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises P2002 and the runner catches & exits.
 */

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { decrypt } from "@/lib/whatsapp/encryption";
import { generateAiReply } from "@/lib/ai/gemini";
import {
  engineSendCtaUrlButton,
  engineSendFlow,
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendTemplate,
  engineSendText,
  engineSendToNumber,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SendTemplateNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a DB mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" && haystack === needle) return true;
    if (matchType === "starts_with" && haystack.startsWith(needle)) return true;
    if (matchType !== "exact" && matchType !== "starts_with" && haystack.includes(needle)) return true;
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_text" ||      // chatbot builder alias for send_message
    node_type === "send_media" ||
    node_type === "send_template" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    node_type === "set_variable" ||
    node_type === "update_contact" ||
    node_type === "delay" ||
    node_type === "join" ||
    node_type === "ai_reply" ||
    node_type === "save_to_table" ||
    node_type === "crm_action" ||
    node_type === "switch_case" ||
    node_type === "send_to_number"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"] | string;
  subjectValue: string | undefined;
  configValue: string | undefined;
  caseSensitive?: boolean;
}): boolean {
  const cs = args.caseSensitive !== false; // default: case-sensitive
  const actual = cs ? (args.subjectValue ?? "") : (args.subjectValue ?? "").toLowerCase();
  const expected = cs ? (args.configValue ?? "") : (args.configValue ?? "").toLowerCase();

  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return actual === expected;
    case "not_equals":
      if (args.subjectValue === undefined) return true;
      return actual !== expected;
    case "contains":
      if (args.subjectValue === undefined) return false;
      return actual.includes(expected);
    case "starts_with":
      if (args.subjectValue === undefined) return false;
      return actual.startsWith(expected);
    case "ends_with":
      if (args.subjectValue === undefined) return false;
      return actual.endsWith(expected);
    case "gt": {
      const a = parseFloat(args.subjectValue ?? "");
      const b = parseFloat(args.configValue ?? "");
      return !isNaN(a) && !isNaN(b) && a > b;
    }
    case "lt": {
      const a = parseFloat(args.subjectValue ?? "");
      const b = parseFloat(args.configValue ?? "");
      return !isNaN(a) && !isNaN(b) && a < b;
    }
    case "gte": {
      const a = parseFloat(args.subjectValue ?? "");
      const b = parseFloat(args.configValue ?? "");
      return !isNaN(a) && !isNaN(b) && a >= b;
    }
    case "lte": {
      const a = parseFloat(args.subjectValue ?? "");
      const b = parseFloat(args.configValue ?? "");
      return !isNaN(a) && !isNaN(b) && a <= b;
    }
    default:
      return false;
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

/**
 * Converts a Prisma FlowRun row to the FlowRunRow shape the engine
 * uses internally (dates → strings, Json → Record).
 */
function toFlowRunRow(row: {
  id: string;
  flow_id: string;
  account_id: string;
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status: string;
  current_node_key: string | null;
  last_prompt_message_id: string | null;
  pending_flow_token?: string | null;
  vars: unknown;
  reprompt_count: number;
  started_at: Date;
  last_advanced_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}): FlowRunRow {
  return {
    id: row.id,
    flow_id: row.flow_id,
    account_id: row.account_id,
    user_id: row.user_id,
    contact_id: row.contact_id,
    conversation_id: row.conversation_id,
    status: row.status as FlowRunRow["status"],
    current_node_key: row.current_node_key,
    last_prompt_message_id: row.last_prompt_message_id,
    pending_flow_token: row.pending_flow_token ?? null,
    vars: (row.vars as Record<string, unknown>) ?? {},
    reprompt_count: row.reprompt_count,
    started_at: row.started_at.toISOString(),
    last_advanced_at: row.last_advanced_at.toISOString(),
    ended_at: row.ended_at?.toISOString() ?? null,
    end_reason: row.end_reason,
  };
}

/**
 * Converts a Prisma Flow row to the FlowRow shape the engine uses.
 */
function toFlowRow(row: {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  trigger_type: string;
  trigger_config: unknown;
  entry_node_id: string | null;
  fallback_policy: unknown;
  execution_count: number;
  last_executed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): FlowRow {
  return {
    id: row.id,
    account_id: row.account_id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status as FlowRow["status"],
    trigger_type: row.trigger_type as FlowRow["trigger_type"],
    trigger_config: row.trigger_config as FlowRow["trigger_config"],
    entry_node_id: row.entry_node_id,
    fallback_policy: row.fallback_policy as FlowRow["fallback_policy"],
    execution_count: row.execution_count,
    last_executed_at: row.last_executed_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Converts a Prisma FlowNode row to the FlowNodeRow shape the engine uses.
 */
function toFlowNodeRow(row: {
  id: string;
  flow_id: string;
  node_key: string;
  node_type: string;
  config: unknown;
  position_x: number;
  position_y: number;
  created_at: Date;
}): FlowNodeRow {
  return {
    id: row.id,
    flow_id: row.flow_id,
    node_key: row.node_key,
    node_type: row.node_type as FlowNodeRow["node_type"],
    config: (row.config as Record<string, unknown>) ?? {},
    position_x: row.position_x,
    position_y: row.position_y,
    created_at: row.created_at.toISOString(),
  };
}

async function loadActiveRunForContact(
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and findFirst picks the newest, let the cron sweep
  // clean up the stale one.
  try {
    const row = await prisma.flowRun.findFirst({
      where: {
        account_id: accountId,
        contact_id: contactId,
        status: "active",
      },
      orderBy: { started_at: "desc" },
    });
    return row ? toFlowRunRow(row) : null;
  } catch (err) {
    console.error("[flows] loadActiveRunForContact error:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function loadFlow(
  flowId: string,
): Promise<FlowRow | null> {
  try {
    const row = await prisma.flow.findUnique({ where: { id: flowId } });
    return row ? toFlowRow(row) : null;
  } catch (err) {
    console.error("[flows] loadFlow error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  try {
    const rows = await prisma.flowNode.findMany({ where: { flow_id: flowId } });
    const map = new Map<string, FlowNodeRow>();
    for (const row of rows) {
      map.set(row.node_key, toFlowNodeRow(row));
    }
    return map;
  } catch (err) {
    console.error("[flows] loadAllNodes error:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

async function logEvent(
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.flowRunEvent.create({
      data: {
        flow_run_id: flowRunId,
        event_type,
        node_key,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", err instanceof Error ? err.message : err);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 */
async function isDuplicateInbound(
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const runs = await prisma.flowRun.findMany({
    where: { account_id: accountId, contact_id: contactId },
    select: { id: true },
  });
  if (!runs.length) return false;
  const runIds = runs.map((r) => r.id);

  const count = await prisma.flowRunEvent.count({
    where: {
      flow_run_id: { in: runIds },
      event_type: "reply_received",
      payload: {
        path: ["meta_message_id"],
        equals: metaMessageId,
      },
    },
  });
  return count > 0;
}

async function findEntryFlow(
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
  channel?: string,
): Promise<FlowRow | null> {
  // Text messages and button replies (from templates or external flows) can
  // both match an entry keyword trigger. For interactive replies we match
  // against reply_title so "Know More" button taps start the right chatbot.
  const triggerText =
    message.kind === "text"
      ? message.text
      : message.kind === "interactive_reply"
        ? message.reply_title
        : null;
  if (!triggerText && message.kind !== "text") return null;
  // Always-on / first_inbound flows should only fire on true text messages,
  // not button taps, to avoid re-starting a flow when the user taps a button
  // that belongs to a template outside this chatbot.
  const allowNonKeyword = message.kind === "text";

  // Pull active flows for this account, filtered by channel so Instagram
  // messages only match Instagram chatbots and vice versa.
  const channelFilter = channel ?? "whatsapp";
  try {
    const rawRows = await prisma.$queryRaw<Parameters<typeof toFlowRow>[0][]>`
      SELECT id, account_id, user_id, name, description, status, trigger_type,
             trigger_config, entry_node_id, fallback_policy,
             execution_count, last_executed_at, created_at, updated_at
      FROM flows
      WHERE account_id = ${accountId}::uuid
        AND status = 'active'
        AND COALESCE(channel, 'whatsapp') = ${channelFilter}
      ORDER BY created_at ASC
    `;
    const rows = rawRows;

    const flows = rows.map(toFlowRow);

    for (const flow of flows) {
      if (flow.trigger_type === "keyword") {
        if (triggerText && matchesKeywordTrigger(
          triggerText,
          flow.trigger_config as KeywordTriggerConfig,
        )) {
          return flow;
        }
      } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound && allowNonKeyword) {
        return flow;
      } else if (flow.trigger_type === "always" && allowNonKeyword) {
        return flow;
      }
      // 'manual' triggers do not auto-start from inbound messages.
    }
  } catch (err) {
    console.error("[flows] findEntryFlow error:", err instanceof Error ? err.message : err);
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  run: FlowRunRow,
  node: FlowNodeRow,
  contact: InterpContact,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  // WhatsApp API requires a non-empty body — fall back to a generic prompt
  // so a node with an empty text field doesn't crash the run.
  const bodyText = interpolateWithContact(
    cfg.text?.trim() || "Please choose an option:",
    run.vars,
    contact,
  );
  try {
    const { whatsapp_message_id } = await engineSendInteractiveButtons({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      bodyText,
      headerText: cfg.header_text
        ? interpolateWithContact(cfg.header_text, run.vars, contact)
        : undefined,
      footerText: cfg.footer_text
        ? interpolateWithContact(cfg.footer_text, run.vars, contact)
        : undefined,
      buttons: cfg.buttons.map((b) => ({
        id: b.reply_id,
        title: interpolateWithContact(b.title, run.vars, contact),
      })),
    });
    await logEvent(run.id, "message_sent", node.node_key, {
      node_type: "send_buttons",
      whatsapp_message_id,
    });
    const msg = await prisma.message.findFirst({
      where: { message_id: whatsapp_message_id },
      select: { id: true },
    });
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { last_prompt_message_id: msg?.id ?? null },
    });
  } catch (err) {
    await logEvent(run.id, "error", node.node_key, {
      reason: "send_buttons_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    await endRun(run.id, "failed", "send_buttons_failed");
  }
  return { outcome: "advanced", node_key: node.node_key };
}

/**
 * CTA-mode `send_buttons`: sends a single WhatsApp "cta_url" button. Unlike
 * the reply-buttons path above, WhatsApp never reports a tap on this button
 * type, so the caller must NOT suspend — advance immediately to
 * `cta_button.next_node_key` once the message is sent.
 */
async function sendCtaButtonAndAdvance(
  run: FlowRunRow,
  node: FlowNodeRow,
  contact: InterpContact,
): Promise<{ next_node_key: string | null }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const cta = cfg.cta_button;
  const bodyText = interpolateWithContact(
    cfg.text?.trim() || "Please tap below:",
    run.vars,
    contact,
  );
  if (!cta?.title?.trim() || !cta?.url?.trim()) {
    await logEvent(run.id, "error", node.node_key, {
      reason: "cta_button_misconfigured",
      detail: "cta_button.title or cta_button.url is empty",
    });
    await endRun(run.id, "failed", "cta_button_misconfigured");
    return { next_node_key: null };
  }
  try {
    const { whatsapp_message_id } = await engineSendCtaUrlButton({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      bodyText,
      displayText: interpolateWithContact(cta.title, run.vars, contact),
      url: interpolateWithContact(cta.url, run.vars, contact),
      headerText: cfg.header_text
        ? interpolateWithContact(cfg.header_text, run.vars, contact)
        : undefined,
      footerText: cfg.footer_text
        ? interpolateWithContact(cfg.footer_text, run.vars, contact)
        : undefined,
    });
    await logEvent(run.id, "message_sent", node.node_key, {
      node_type: "send_buttons",
      mode: "cta",
      whatsapp_message_id,
    });
  } catch (err) {
    await logEvent(run.id, "error", node.node_key, {
      reason: "send_cta_button_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    await endRun(run.id, "failed", "send_cta_button_failed");
    return { next_node_key: null };
  }
  return { next_node_key: cta.next_node_key || null };
}

async function sendListAndSuspend(
  run: FlowRunRow,
  node: FlowNodeRow,
  contact: InterpContact,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  // WhatsApp API requires a non-empty body — fall back to a generic prompt.
  const bodyText = interpolateWithContact(
    cfg.text?.trim() || "Please select an option:",
    run.vars,
    contact,
  );
  try {
    const { whatsapp_message_id } = await engineSendInteractiveList({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      bodyText,
      buttonLabel: interpolateWithContact(
        cfg.button_label || "View options",
        run.vars,
        contact,
      ),
      headerText: cfg.header_text
        ? interpolateWithContact(cfg.header_text, run.vars, contact)
        : undefined,
      footerText: cfg.footer_text
        ? interpolateWithContact(cfg.footer_text, run.vars, contact)
        : undefined,
      sections: cfg.sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          id: r.reply_id,
          title: interpolateWithContact(r.title, run.vars, contact),
          description: r.description
            ? interpolateWithContact(r.description, run.vars, contact)
            : r.description,
        })),
      })),
    });
    await logEvent(run.id, "message_sent", node.node_key, {
      node_type: "send_list",
      whatsapp_message_id,
    });
    const msg = await prisma.message.findFirst({
      where: { message_id: whatsapp_message_id },
      select: { id: true },
    });
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { last_prompt_message_id: msg?.id ?? null },
    });
  } catch (err) {
    await logEvent(run.id, "error", node.node_key, {
      reason: "send_list_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    await endRun(run.id, "failed", "send_list_failed");
  }
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string; notify_message?: string; timeout_hours?: number };
  if (run.conversation_id) {
    // Verify the agent still exists before assigning — the user may have been
    // deleted since the chatbot was configured, which would violate the FK.
    let resolvedAgentId: string | undefined = undefined;
    if (cfg.assign_to) {
      const agentExists = await prisma.user.findUnique({
        where: { id: cfg.assign_to },
        select: { id: true },
      });
      resolvedAgentId = agentExists?.id;
    }

    const updatedConv = await prisma.conversation.update({
      where: { id: run.conversation_id },
      data: {
        status: "pending",
        ...(resolvedAgentId ? { assigned_agent_id: resolvedAgentId } : {}),
      },
    });

    // Notify the inbox in real-time so agents see the pending assignment immediately.
    const { emitToAccount } = await import("@/lib/socket");
    emitToAccount(run.account_id, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} });

    if (resolvedAgentId) {
      const contact = run.contact_id
        ? await prisma.contact.findUnique({
            where: { id: run.contact_id },
            select: { name: true, phone: true },
          })
        : null;

      // Push notification to the assigned agent
      try {
        const { sendPushToUser } = await import("@/lib/push");
        const contactName = contact?.name ?? contact?.phone ?? "a contact";
        void sendPushToUser(resolvedAgentId, {
          title: "Conversation Handed Off to You",
          body: `Chatbot handed off ${contactName}'s conversation`,
          tag: `handoff-${run.conversation_id}`,
          data: { type: "assignment", conversationId: run.conversation_id },
        });
      } catch { /* ignore push errors */ }

      // WhatsApp notification to the agent's personal WhatsApp number
      if (cfg.notify_message) {
        try {
          const agentUser = await prisma.user.findUnique({
            where: { id: resolvedAgentId },
            select: { email: true },
          });
          const agentEmail = agentUser?.email ?? "";
          if (agentEmail.endsWith("@agent.local")) {
            const agentPhone = agentEmail.replace("@agent.local", "");
            const waConfig = await prisma.whatsAppConfig.findUnique({
              where: { account_id: run.account_id },
            });
            if (waConfig && agentPhone) {
              const lastMsg = await prisma.message.findFirst({
                where: { conversation_id: run.conversation_id, sender_type: "contact" },
                orderBy: { created_at: "desc" },
                select: { content_text: true },
              });
              const accessToken = decrypt(waConfig.access_token);
              const contactName = contact?.name ?? contact?.phone ?? "Unknown";
              const contactPhone = contact?.phone ?? "";
              const lastMsgText = lastMsg?.content_text ?? "";
              const text = cfg.notify_message
                // canonical forms
                .replace(/\{\{contact\.name\}\}/gi, contactName)
                .replace(/\{\{contact\.phone\}\}/gi, contactPhone)
                .replace(/\{\{last_message\}\}/gi, lastMsgText)
                // short aliases: {{name}}, {{number}}
                .replace(/\{\{name\}\}/gi, contactName)
                .replace(/\{\{number\}\}/gi, contactPhone)
                // Profile.* aliases used by the builder variable picker
                .replace(/\{\{Profile\.name\}\}/gi, contactName)
                .replace(/\{\{Profile\.number\}\}/gi, contactPhone)
                .replace(/\{\{Profile\.phone\}\}/gi, contactPhone);
              const { sendTextMessage } = await import("@/lib/whatsapp/meta-api");
              await sendTextMessage({
                phoneNumberId: waConfig.phone_number_id,
                accessToken,
                to: agentPhone,
                text,
              });
            }
          }
        } catch { /* ignore WhatsApp notification errors */ }
      }
    }
  }
  await logEvent(run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a DB mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const count = await prisma.contactTag.count({
      where: {
        contact_id: run.contact_id!,
        tag_id: cfg.subject_key,
      },
    });
    // For tags, "present"/"absent" are the natural operators.
    subjectValue = count > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const contact = await prisma.contact.findUnique({
      where: { id: run.contact_id! },
      select: { [cfg.subject_key]: true },
    }) as Record<string, unknown> | null;
    const raw = contact?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
    caseSensitive: (cfg as unknown as Record<string, unknown>).case_sensitive !== false,
  });
}

/**
 * Full interpolation for nodes that need contact fields:
 *   {{vars.X}}          → flow run variable
 *   {{contact.name}}    → contact's saved name
 *   {{contact.phone}}   → contact's phone number
 *   {{contact.email}}   → contact's email
 *   {{contact.company}} → contact's company
 *   {{name}}            → shorthand for {{contact.name}}
 *   {{phone}} / {{number}} → shorthand for {{contact.phone}}
 */
export function interpolateWithContact(
  template: string,
  vars: Record<string, unknown>,
  contact: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
  } | null,
): string {
  if (!template) return "";
  const name = contact?.name ?? contact?.phone ?? "";
  const phone = contact?.phone ?? "";
  const email = contact?.email ?? "";
  const company = contact?.company ?? "";
  return template
    .replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
      const v = vars[key];
      return v === undefined || v === null ? "" : String(v);
    })
    .replace(/\{\{contact\.name\}\}/gi, name)
    .replace(/\{\{contact\.phone\}\}/gi, phone)
    .replace(/\{\{contact\.email\}\}/gi, email)
    .replace(/\{\{contact\.company\}\}/gi, company)
    .replace(/\{\{name\}\}/gi, name)
    .replace(/\{\{phone\}\}/gi, phone)
    .replace(/\{\{number\}\}/gi, phone);
}

/** Contact shape used by interpolation call sites — see interpolateWithContact. */
type InterpContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
} | null;

/**
 * Memoized per-invocation contact fetcher — a single call site (e.g. one
 * `advanceFromNodeKey` pass) can visit many nodes that each want
 * `{{contact.x}}` interpolation; this fetches at most once and lets
 * `update_contact` keep the cache in sync via `patch()` so a later node in
 * the same pass doesn't read a stale value.
 */
function createContactGetter(contactId: string | null) {
  let cache: InterpContact | undefined;
  return {
    async get(): Promise<InterpContact> {
      if (cache !== undefined) return cache;
      cache = contactId
        ? await prisma.contact.findUnique({
            where: { id: contactId },
            select: { name: true, phone: true, email: true, company: true },
          })
        : null;
      return cache;
    },
    patch(partial: Record<string, unknown>): void {
      if (cache !== undefined && cache !== null) {
        cache = { ...cache, ...partial } as InterpContact;
      }
    },
  };
}

/**
 * Validate a user's reply against a collect_input node's input_type.
 * Returns true when the value is acceptable, false when it should be rejected.
 */
function validateCollectInputValue(
  inputType: string,
  value: string,
  cfg: Record<string, unknown>,
): boolean {
  const v = value.trim();
  switch (inputType) {
    case "number": {
      const n = Number(v);
      if (isNaN(n) || v === "") return false;
      const validation = cfg.validation as Record<string, unknown> | undefined;
      if (validation?.min !== undefined && n < Number(validation.min)) return false;
      if (validation?.max !== undefined && n > Number(validation.max)) return false;
      return true;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case "website":
      return /^(https?:\/\/|www\.).+\..+/.test(v);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
    case "time":
      return /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
    case "phone":
      return /^[\d\s+\-().]{6,}$/.test(v);
    default:
      // text, file, location — accept anything
      return true;
  }
}

const DEFAULT_VALIDATION_ERRORS: Record<string, string> = {
  number:  "Please enter a valid number.",
  email:   "Please enter a valid email address.",
  website: "Please enter a valid website URL (e.g. https://example.com).",
  date:    "Please enter a date in YYYY-MM-DD format.",
  time:    "Please enter a time in HH:MM format.",
  phone:   "Please enter a valid phone number.",
};

async function endRun(
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await prisma.flowRun.update({
    where: { id: runId },
    data: {
      status,
      ended_at: new Date(),
      end_reason: reason,
    },
  });
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
  inboundMessage?: ParsedInbound,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Fetched at most once per call — many auto-advancing nodes can be
  // visited in a single pass, so this avoids a redundant query per node.
  const contactGetter = createContactGetter(run.contact_id);
  const getContact = (): Promise<InterpContact> => contactGetter.get();
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateWithContact(cfg.text, run.vars, await getContact()),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      if (!cfg.media_url) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: "media_url is empty",
        });
        await endRun(run.id, "failed", "send_media_missing_url");
        return { outcome: "completed" };
      }
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: (cfg.media_type ?? "image") as import("@/lib/whatsapp/meta-api").MediaKind,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateWithContact(cfg.caption, run.vars, await getContact())
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_media",
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_media_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateWithContact(cfg.prompt_text, run.vars, await getContact()),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const msg = await prisma.message.findFirst({
          where: { message_id: whatsapp_message_id },
          select: { id: true },
        });
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { last_prompt_message_id: msg?.id ?? null },
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "switch_case") {
      const cfg = node.config as {
        variable?: string;
        case_sensitive?: boolean;
        cases?: Array<{ value: string; next_node_key: string }>;
        default_next?: string;
      };
      const varKey = cfg.variable ?? "";
      const rawValue = typeof run.vars[varKey] === "string" ? (run.vars[varKey] as string) : "";
      const caseSensitive = cfg.case_sensitive === true;
      const matchValue = caseSensitive ? rawValue : rawValue.toLowerCase();

      const matched = (cfg.cases ?? []).find((c) => {
        const caseVal = typeof c.value === "string" ? c.value : "";
        return caseSensitive ? caseVal === rawValue : caseVal.toLowerCase() === matchValue;
      });

      currentKey = matched?.next_node_key || cfg.default_next || null;
      await logEvent(run.id, "node_entered", node.node_key, {
        variable: varKey,
        value: rawValue,
        matched_case: matched?.value ?? "default",
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await prisma.contactTag.upsert({
            where: {
              contact_id_tag_id: {
                contact_id: run.contact_id!,
                tag_id: cfg.tag_id,
              },
            },
            create: { contact_id: run.contact_id!, tag_id: cfg.tag_id },
            update: {},
          });
        } else {
          await prisma.contactTag.deleteMany({
            where: {
              contact_id: run.contact_id!,
              tag_id: cfg.tag_id,
            },
          });
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_template") {
      const cfg = node.config as unknown as SendTemplateNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendTemplate({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          templateName: cfg.template_name,
          languageCode: cfg.language_code || "en_US",
          bodyParams: cfg.body_params,
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_template",
          template_name: cfg.template_name,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_template_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_template_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      const cfg = node.config as unknown as SendButtonsNodeConfig;
      if (cfg.mode === "cta") {
        const { next_node_key } = await sendCtaButtonAndAdvance(
          run,
          node,
          await getContact(),
        );
        if (!next_node_key) {
          return { outcome: "completed" };
        }
        currentKey = next_node_key;
        continue;
      }
      await sendButtonsAndSuspend(run, node, await getContact());
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(run, node, await getContact());
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      await executeHandoff(run, node);
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(run.id, "completed", node.node_key);
      await endRun(run.id, "completed", "end_node");
      return { outcome: "completed" };
    }

    // ── Chatbot-builder node types ────────────────────────────────
    // send_text is the chatbot builder's equivalent of send_message.
    if (node.node_type === "send_text") {
      const cfg = node.config as { text?: string; next_node_key?: string };
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateWithContact(cfg.text ?? "", run.vars, await getContact()),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_text",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // set_variable — write one or more vars into run.vars, then advance.
    if (node.node_type === "set_variable") {
      const cfg = node.config as { assignments?: Array<{ var_key: string; value: string }>; next_node_key?: string };
      const newVars: Record<string, unknown> = { ...run.vars };
      const contactForVars = await getContact();
      for (const a of cfg.assignments ?? []) {
        if (a.var_key) newVars[a.var_key] = interpolateWithContact(a.value ?? "", run.vars, contactForVars);
      }
      await prisma.flowRun.update({ where: { id: run.id }, data: { vars: newVars as Record<string, string> } });
      run = { ...run, vars: newVars };
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // update_contact — update a standard or custom contact field, then advance.
    if (node.node_type === "update_contact") {
      const cfg = node.config as { field?: string; value?: string; next_node_key?: string };
      if (cfg.field && run.contact_id) {
        const STANDARD = ["name", "email", "company"] as const;
        const val = interpolateWithContact(cfg.value ?? "", run.vars, await getContact());
        if ((STANDARD as readonly string[]).includes(cfg.field)) {
          await prisma.contact.update({
            where: { id: run.contact_id },
            data: { [cfg.field]: val },
          }).catch(() => {/* non-fatal */});
          // Keep the cached contact in sync so a later node in the same
          // pass that reads {{contact.x}} doesn't see a stale value.
          contactGetter.patch({ [cfg.field]: val });
        }
      }
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // delay — no actual async wait in the synchronous runner; just advance.
    if (node.node_type === "delay") {
      const cfg = node.config as { next_node_key?: string };
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // join — transparent merge node; just advance.
    if (node.node_type === "join") {
      const cfg = node.config as { next_node_key?: string };
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // ai_reply — call Gemini with account config and send the response.
    if (node.node_type === "ai_reply") {
      const cfg = node.config as {
        next_node_key?: string;
        var_key?: string;
      };
      try {
        const aiConfig = await prisma.aiConfig.findUnique({
          where: { account_id: run.account_id },
        });
        if (!aiConfig) {
          await logEvent(run.id, "error", node.node_key, { reason: "ai_config_not_found" });
          await endRun(run.id, "failed", "ai_config_not_found");
          return { outcome: "completed" };
        }
        const apiKey = decrypt(aiConfig.api_key);
        const trainingData = Array.isArray(aiConfig.training_data)
          ? (aiConfig.training_data as Array<{ question: string; answer: string }>)
          : [];
        const lastUserMessage =
          inboundMessage?.kind === "text" ? inboundMessage.text : "";
        const reply = await generateAiReply(
          {
            apiKey,
            model: aiConfig.model,
            temperature: aiConfig.temperature,
            maxTokens: aiConfig.max_tokens,
            systemPrompt: aiConfig.system_prompt ?? undefined,
            trainingData,
          },
          lastUserMessage,
        );
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: reply,
        });
        if (cfg.var_key) {
          const newVars = { ...run.vars, [cfg.var_key]: reply };
          await prisma.flowRun.update({
            where: { id: run.id },
            data: { vars: newVars as Record<string, string> },
          });
          run = { ...run, vars: newVars };
        }
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "ai_reply",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "ai_reply_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "ai_reply_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // save_to_table — create a DataRecord with interpolated field values.
    if (node.node_type === "save_to_table") {
      const cfg = node.config as {
        table_id?: string;
        field_mappings?: Array<{ field_key: string; value: string }>;
        next_node_key?: string;
      };
      if (cfg.table_id) {
        try {
          const recordData: Record<string, unknown> = {};
          const contactForTable = await getContact();
          for (const m of cfg.field_mappings ?? []) {
            if (m.field_key) {
              recordData[m.field_key] = interpolateWithContact(m.value ?? "", run.vars, contactForTable);
            }
          }
          await prisma.dataRecord.create({
            data: {
              table_id: cfg.table_id,
              account_id: run.account_id,
              data: recordData as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          await logEvent(run.id, "error", node.node_key, {
            reason: "save_to_table_failed",
            error: String(err),
          });
        }
      }
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // crm_action — perform a CRM operation on the contact, then advance.
    if (node.node_type === "crm_action") {
      const cfg = node.config as {
        action?: string;
        next_node_key?: string;
        // lead
        lead_title?: string;
        lead_source?: string;
        lead_status?: string;
        lead_score?: string;
        lead_quality?: string;
        lead_district?: string;
        lead_place?: string;
        lead_assigned_to?: string;
        lead_mode?: 'upsert' | 'create_new';
        // segment
        segment_id?: string;
        // followup
        followup_title?: string;
        followup_note?: string;
        followup_due_hours?: number;
        followup_assigned_to?: string;
        // task
        task_title?: string;
        task_description?: string;
        task_priority?: string;
        task_due_days?: number;
        task_assigned_to?: string;
      };

      if (run.contact_id) {
        try {
          const contact = await getContact();
          const contactName = contact?.name ?? contact?.phone ?? "Contact";

          const action = cfg.action ?? "create_lead";

          if (action === "create_lead") {
            const title = interpolateWithContact(cfg.lead_title || contactName, run.vars, contact) || contactName;
            const leadMode = cfg.lead_mode ?? "upsert";

            // "upsert" (default): update the most-recent lead for this contact
            // if one already exists — prevents duplicate leads from repeated
            // chatbot submissions. "create_new" always creates a fresh lead.
            const existingLead =
              leadMode === "upsert"
                ? await prisma.lead.findFirst({
                    where: { account_id: run.account_id, contact_id: run.contact_id },
                    orderBy: { created_at: "desc" },
                    select: { id: true },
                  })
                : null;

            if (existingLead) {
              await prisma.lead.update({
                where: { id: existingLead.id },
                data: {
                  title,
                  ...(cfg.lead_source ? { source: cfg.lead_source } : {}),
                  ...(cfg.lead_status ? { status: cfg.lead_status } : {}),
                  ...(cfg.lead_score ? { score: cfg.lead_score } : {}),
                  ...(cfg.lead_quality ? { lead_quality: cfg.lead_quality } : {}),
                  ...(cfg.lead_district ? { district: cfg.lead_district } : {}),
                  ...(cfg.lead_place ? { place: cfg.lead_place } : {}),
                  ...(cfg.lead_assigned_to ? { assigned_to: cfg.lead_assigned_to } : {}),
                },
              });
              await prisma.leadActivity.create({
                data: {
                  account_id: run.account_id,
                  lead_id: existingLead.id,
                  contact_id: run.contact_id,
                  user_id: run.user_id,
                  type: "note",
                  title: "Lead updated by chatbot",
                  description: `Lead "${title}" was updated automatically by a chatbot flow`,
                },
              });
            } else {
              const newLead = await prisma.lead.create({
                data: {
                  account_id: run.account_id,
                  user_id: run.user_id,
                  contact_id: run.contact_id,
                  title,
                  source: cfg.lead_source || "whatsapp",
                  status: cfg.lead_status || "new",
                  score: cfg.lead_score || "warm",
                  ...(cfg.lead_quality ? { lead_quality: cfg.lead_quality } : {}),
                  ...(cfg.lead_district ? { district: cfg.lead_district } : {}),
                  ...(cfg.lead_place ? { place: cfg.lead_place } : {}),
                  ...(cfg.lead_assigned_to ? { assigned_to: cfg.lead_assigned_to } : {}),
                },
              });
              await prisma.leadActivity.create({
                data: {
                  account_id: run.account_id,
                  lead_id: newLead.id,
                  contact_id: run.contact_id,
                  user_id: run.user_id,
                  type: "created",
                  title: "Lead created via chatbot",
                  description: `Lead "${title}" was created automatically by a chatbot flow`,
                },
              });
              const { emitToAccount } = await import("@/lib/socket");
              emitToAccount(run.account_id, "lead", { eventType: "INSERT", new: newLead, old: {} });
            }

          } else if (action === "add_to_segment" && cfg.segment_id) {
            // Segments work by filter_config evaluation — we store a direct
            // contact link on the contact via a tag convention or just mark
            // via custom field. Since segments in this CRM are filter-based
            // (not manual membership), we add the contact to the segment by
            // creating a tag named after the segment if it exists, or we
            // update a dedicated segment membership table if one is added
            // later. For now: look up the segment and create a ContactTag
            // with a matching tag_id if the segment has one, otherwise log.
            const segment = await prisma.segment.findFirst({
              where: { id: cfg.segment_id, account_id: run.account_id },
              select: { id: true, name: true },
            });
            if (segment) {
              // Find or create a tag matching this segment name
              let tag = await prisma.tag.findFirst({
                where: { account_id: run.account_id, name: `[Segment] ${segment.name}` },
                select: { id: true },
              });
              if (!tag) {
                tag = await prisma.tag.create({
                  data: {
                    account_id: run.account_id,
                    user_id: run.user_id,
                    name: `[Segment] ${segment.name}`,
                    color: "#3b82f6",
                  },
                  select: { id: true },
                });
              }
              await prisma.contactTag.upsert({
                where: {
                  contact_id_tag_id: {
                    contact_id: run.contact_id,
                    tag_id: tag.id,
                  },
                },
                create: { contact_id: run.contact_id, tag_id: tag.id },
                update: {},
              });
            }

          } else if (action === "create_followup") {
            const dueHours = cfg.followup_due_hours ?? 24;
            const dueAt = new Date(Date.now() + dueHours * 60 * 60 * 1000);
            const title = interpolateWithContact(cfg.followup_title || `Follow up with ${contactName}`, run.vars, contact);
            // Link the follow-up to the contact's most recent lead so it shows in the lead timeline
            const recentLeadForFollowup = await prisma.lead.findFirst({
              where: { account_id: run.account_id, contact_id: run.contact_id, status: { not: "closed" } },
              orderBy: { created_at: "desc" },
              select: { id: true },
            });
            const followUp = await prisma.followUp.create({
              data: {
                account_id: run.account_id,
                user_id: run.user_id,
                contact_id: run.contact_id,
                lead_id: recentLeadForFollowup?.id ?? null,
                title,
                note: cfg.followup_note
                  ? interpolateWithContact(cfg.followup_note, run.vars, contact)
                  : null,
                due_at: dueAt,
                status: "pending",
                ...(cfg.followup_assigned_to ? { assigned_to: cfg.followup_assigned_to } : {}),
              },
            });
            // Log in lead activity if linked to a lead
            if (recentLeadForFollowup) {
              await prisma.leadActivity.create({
                data: {
                  account_id: run.account_id,
                  lead_id: recentLeadForFollowup.id,
                  contact_id: run.contact_id,
                  user_id: run.user_id,
                  type: "follow_up",
                  title: "Follow-up scheduled by chatbot",
                  description: `"${title}" due in ${dueHours}h — created automatically by a chatbot flow`,
                  metadata: { follow_up_id: followUp.id },
                },
              });
            }

          } else if (action === "create_task") {
            const dueDays = cfg.task_due_days ?? 1;
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + dueDays);
            const title = interpolateWithContact(cfg.task_title || `Task for ${contactName}`, run.vars, contact);
            // Link task to the contact's most recent active lead
            const recentLeadForTask = await prisma.lead.findFirst({
              where: { account_id: run.account_id, contact_id: run.contact_id, status: { not: "closed" } },
              orderBy: { created_at: "desc" },
              select: { id: true },
            });
            await prisma.task.create({
              data: {
                account_id: run.account_id,
                user_id: run.user_id,
                contact_id: run.contact_id,
                lead_id: recentLeadForTask?.id ?? null,
                title,
                description: cfg.task_description
                  ? interpolateWithContact(cfg.task_description, run.vars, contact)
                  : null,
                priority: cfg.task_priority || "medium",
                status: "todo",
                due_date: dueDate,
                ...(cfg.task_assigned_to ? { assigned_to: cfg.task_assigned_to } : {}),
              },
            });
          }
        } catch (err) {
          // Non-fatal — log and advance so the customer flow isn't blocked.
          await logEvent(run.id, "error", node.node_key, {
            reason: "crm_action_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }

      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // http_request — make an outbound HTTP call, optionally save the response body
    // to a flow variable, then advance. Errors route to error_node_key if set.
    if (node.node_type === "http_request") {
      const cfg = node.config as {
        method?: string;
        url?: string;
        headers?: Record<string, string>;
        body?: string;
        response_var?: string;
        next_node_key?: string;
        error_node_key?: string;
      };
      const method = cfg.method ?? "GET";
      const contactForHttp = await getContact();
      const url = interpolateWithContact(cfg.url ?? "", run.vars, contactForHttp);
      let httpError = false;
      try {
        const reqInit: RequestInit = {
          method,
          headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) },
        };
        if (cfg.body && method !== "GET" && method !== "HEAD") {
          reqInit.body = interpolateWithContact(cfg.body, run.vars, contactForHttp);
        }
        const resp = await fetch(url, reqInit);
        const text = await resp.text();
        if (cfg.response_var) {
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          const newVars = { ...run.vars, [cfg.response_var]: parsed };
          await prisma.flowRun.update({ where: { id: run.id }, data: { vars: newVars as Record<string, string> } });
          run = { ...run, vars: newVars };
        }
        if (!resp.ok && cfg.error_node_key) {
          await logEvent(run.id, "error", node.node_key, { reason: "http_non_ok", status: resp.status, url });
          httpError = true;
        } else {
          await logEvent(run.id, "node_entered", node.node_key, { http_status: resp.status, url });
        }
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "http_request_failed",
          detail: err instanceof Error ? err.message : String(err),
          url,
        });
        httpError = true;
      }
      if (httpError && cfg.error_node_key) {
        currentKey = cfg.error_node_key;
      } else {
        currentKey = cfg.next_node_key ?? "";
      }
      continue;
    }

    // link_chatbot — jump to another chatbot template by ending this run and
    // starting a new one for the linked flow. Falls back to ending silently if
    // the linked chatbot doesn't exist.
    if (node.node_type === "link_chatbot") {
      const cfg = node.config as { target_chatbot_id?: string };
      await logEvent(run.id, "completed", node.node_key, {
        reason: "link_chatbot",
        target: cfg.target_chatbot_id ?? null,
      });
      await endRun(run.id, "completed", "link_chatbot");

      if (cfg.target_chatbot_id) {
        try {
          const linkedFlow = await loadFlow(cfg.target_chatbot_id);
          if (linkedFlow && linkedFlow.status === "active" && linkedFlow.entry_node_id) {
            const linkedNodes = await loadAllNodes(linkedFlow.id);
            // Create a new run for the linked chatbot, reusing the same conversation.
            const inserted = await prisma.flowRun.create({
              data: {
                flow_id: linkedFlow.id,
                account_id: run.account_id,
                user_id: run.user_id,
                contact_id: run.contact_id,
                conversation_id: run.conversation_id,
                status: "active",
                current_node_key: linkedFlow.entry_node_id,
              },
            });
            const linkedRun = toFlowRunRow(inserted);
            await logEvent(linkedRun.id, "started", linkedFlow.entry_node_id, {
              linked_from_flow_run: run.id,
            });
            await advanceFromNodeKey(linkedRun, linkedFlow.entry_node_id, linkedNodes);
          }
        } catch (err) {
          console.error("[flows] link_chatbot failed:", err instanceof Error ? err.message : err);
        }
      }
      return { outcome: "completed" };
    }

    // send_flow — send a Meta WhatsApp Flows interactive message, then
    // suspend (same pattern as collect_input): current_node_key is pinned
    // to this node's own key, and a random flow_token is minted and sent
    // to WhatsApp along with the Flow so the completed submission (an
    // nfm_reply on the main webhook) can be matched back to this exact
    // paused run and resumed with the answers loaded into run.vars.
    if (node.node_type === "send_flow") {
      const cfg = node.config as {
        flow_id?: string;
        button_text?: string;
        body_text?: string;
        header_text?: string;
        footer_text?: string;
        next_node_key?: string;
      };
      if (cfg.flow_id && run.conversation_id) {
        try {
          const flowToken = crypto.randomUUID();
          const { whatsapp_message_id } = await engineSendFlow({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id,
            contactId: run.contact_id!,
            flowId: cfg.flow_id,
            flowCta: cfg.button_text ?? "Open form",
            bodyText: cfg.body_text,
            headerText: cfg.header_text,
            footerText: cfg.footer_text,
            flowToken,
          });
          await prisma.flowRun.update({
            where: { id: run.id },
            data: { pending_flow_token: flowToken },
          });
          const { emitToAccount } = await import("@/lib/socket");
          emitToAccount(run.account_id, "message", { eventType: "INSERT" });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "send_flow",
            flow_id: cfg.flow_id,
            whatsapp_message_id,
          });
        } catch (err) {
          await logEvent(run.id, "error", node.node_key, {
            reason: "send_flow_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          await endRun(run.id, "failed", "send_flow_failed");
          return { outcome: "completed" };
        }
        const advanced = await advanceCurrentNodeKey(
          run.id,
          run.current_node_key,
          node.node_key,
        );
        if (!advanced) {
          await logEvent(run.id, "error", node.node_key, {
            reason: "lost_race_during_advance",
          });
        }
        return { outcome: "advanced" };
      }
      // No flow_id configured, or no conversation to send into — nothing
      // was sent, so there's nothing to wait for; fall through as before.
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // send_to_number — send a WhatsApp message to an arbitrary phone number
    // as a side-effect (admin notification). Failure is non-fatal: the flow
    // continues to next_node_key regardless so the customer is never blocked.
    if (node.node_type === "send_to_number") {
      const cfg = node.config as { phone?: string; text?: string; next_node_key?: string };
      // {{name}}, {{contact.name}} etc. are substituted via the shared getContact() cache.
      const contactForInterp = await getContact();
      const rawPhone = interpolateWithContact(cfg.phone ?? "", run.vars, contactForInterp);
      const text = interpolateWithContact(cfg.text ?? "", run.vars, contactForInterp);
      if (rawPhone && text) {
        try {
          await engineSendToNumber({ accountId: run.account_id, phone: rawPhone, text });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "send_to_number",
            to: rawPhone,
          });
        } catch (err) {
          await logEvent(run.id, "error", node.node_key, {
            reason: "send_to_number_failed",
            detail: err instanceof Error ? err.message : String(err),
          });
          // Non-fatal — advance anyway
        }
      } else {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_to_number_skipped",
          detail: !rawPhone ? "phone is empty after interpolation" : "text is empty",
        });
      }
      currentKey = cfg.next_node_key ?? "";
      continue;
    }

    // Unknown node type — log and fail the run rather than spin forever.
    await logEvent(run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 *
 * Prisma doesn't support conditional WHERE on a nullable field in
 * updateMany cleanly, so we use a raw approach: match on both the
 * run id and the expected current_node_key value.
 */
async function advanceCurrentNodeKey(
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  const result = await prisma.flowRun.updateMany({
    where: {
      id: runId,
      status: "active",
      current_node_key: expectedOldKey === null ? null : expectedOldKey,
    },
    data: {
      current_node_key: newKey,
      last_advanced_at: new Date(),
    },
  });
  return result.count > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  try {
    const activeRun = await loadActiveRunForContact(
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(activeRun.flow_id);
      return handleReplyForActiveRun(activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
      input.channel,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(flow.id);
    return startNewRun(flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // Fetched at most once per call — separate cache from advanceFromNodeKey's,
  // since this is a different function invocation.
  const contactGetter = createContactGetter(run.contact_id);
  const getContact = (): Promise<InterpContact> => contactGetter.get();
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);

    // If save_reply_to is configured, persist the selected item's title to vars.
    const saveVarKey = currentNode.config.save_reply_to as string | undefined;
    if (matched && saveVarKey) {
      let selectedTitle = message.reply_id;
      if (currentNode.node_type === "send_buttons") {
        const cfg = currentNode.config as unknown as SendButtonsNodeConfig;
        const btn = cfg.buttons?.find((b) => b.reply_id === message.reply_id);
        if (btn?.title) selectedTitle = btn.title;
      } else {
        const cfg = currentNode.config as unknown as SendListNodeConfig;
        outer: for (const section of cfg.sections ?? []) {
          for (const row of section.rows ?? []) {
            if (row.reply_id === message.reply_id) { selectedTitle = row.title; break outer; }
          }
        }
      }
      try {
        const newVars = { ...run.vars, [saveVarKey]: selectedTitle };
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { vars: newVars as Prisma.InputJsonValue },
        });
        run.vars = newVars;
      } catch {
        // non-fatal — proceed without saving
      }
    }
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    // The chatbot builder stores extra fields not in flows/types.ts
    const rawCfg = currentNode.config as Record<string, unknown>;
    const inputType = typeof rawCfg.input_type === "string" ? rawCfg.input_type : "text";
    const captured = message.text.trim();

    if (captured.length > 0 && cfg.var_key) {
      // Validate against input_type before accepting the value.
      const valid = validateCollectInputValue(inputType, captured, rawCfg);
      if (!valid) {
        // Send the custom or default error message and stay on this node.
        const validation = rawCfg.validation as Record<string, unknown> | undefined;
        const errMsg =
          (typeof validation?.error_message === "string" && validation.error_message.trim())
            ? validation.error_message.trim()
            : (DEFAULT_VALIDATION_ERRORS[inputType] ?? "Invalid input. Please try again.");
        try {
          await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: errMsg,
          });
        } catch {
          // non-fatal — keep the run alive
        }
        return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
      }

      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      try {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { vars: newVars as Prisma.InputJsonValue, reprompt_count: 0 },
        });
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      } catch {
        // capture update failed — fall through to fallback
      }
    }
  } else if (
    message.kind === "flow_reply" &&
    currentNode.node_type === "send_flow"
  ) {
    // Only accept a submission whose token matches the one we minted when
    // this specific send_flow suspended — guards against a stale/duplicate
    // nfm_reply (e.g. Meta retry, or a reply to a Flow sent by an earlier,
    // already-superseded run) being applied to the wrong node.
    if (run.pending_flow_token && message.flow_token === run.pending_flow_token) {
      const cfg = currentNode.config as {
        next_node_key?: string;
      };
      // Namespaced with a "flow_" prefix so these sit alongside other
      // {{vars.x}} without colliding with variables set elsewhere in the
      // chatbot (e.g. by set_variable or collect_input).
      const flowVars: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(message.response)) {
        flowVars[`flow_${key}`] = value;
      }
      const newVars = { ...run.vars, ...flowVars };
      try {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { vars: newVars as Prisma.InputJsonValue, pending_flow_token: null },
        });
        run.vars = newVars;
        await logEvent(run.id, "node_entered", currentNode.node_key, {
          captured_flow_vars: Object.keys(flowVars),
        });
        matched = cfg.next_node_key ?? null;
      } catch {
        // capture update failed — fall through to fallback
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0.
    if (run.reprompt_count !== 0) {
      try {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { reprompt_count: 0 },
        });
        run.reprompt_count = 0;
      } catch {
        // non-fatal
      }
    }
    const outcome = await advanceFromNodeKey(run, matched, nodes, message);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await prisma.flowRun.update({
    where: { id: run.id },
    data: { reprompt_count: newReprompts },
  });

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(run, currentNode, await getContact());
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(run, currentNode, await getContact());
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateWithContact(cfg.prompt_text, run.vars, await getContact()),
        });
      } catch (err) {
        await logEvent(run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await prisma.conversation.update({
        where: { id: run.conversation_id },
        data: { status: "pending" },
      });
    }
    await logEvent(run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // INSERT — the unique constraint on (account_id, contact_id) for
  // active runs catches concurrent inserts with P2002. We catch and
  // return consumed:true (the parallel webhook handles it).
  let run: FlowRunRow;
  try {
    const inserted = await prisma.flowRun.create({
      data: {
        flow_id: flow.id,
        // Tenancy: NOT NULL post-017.
        account_id: flow.account_id,
        // Audit: preserves the flow's author on the run row.
        user_id: flow.user_id,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        status: "active",
        current_node_key: flow.entry_node_id,
      },
    });
    run = toFlowRunRow(inserted);
  } catch (err) {
    // P2002 = unique_violation → another webhook is starting the run.
    if (
      err instanceof PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", err instanceof Error ? err.message : err);
    return { consumed: false, outcome: "no_match" };
  }

  await logEvent(run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });

  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  // Atomic increment to avoid read-modify-write races with concurrent runs.
  try {
    const updated = await prisma.flow.update({
      where: { id: flow.id },
      data: { execution_count: { increment: 1 } },
      select: { id: true, execution_count: true },
    });
    const { emitToAccount } = await import("@/lib/socket");
    emitToAccount(flow.account_id, "chatbot", { id: updated.id, execution_count: updated.execution_count });
  } catch (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count increment error:", incErr instanceof Error ? incErr.message : incErr);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(run, flow.entry_node_id!, nodes, input.message);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
