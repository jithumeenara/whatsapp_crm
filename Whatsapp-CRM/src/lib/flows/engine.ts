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
import { resolveWhatsAppConfig } from "@/lib/whatsapp/resolve-config";
import { getProviderKeys } from "@/lib/ai/providers/registry";
import { generateCustomerReply } from "@/lib/ai/customer-agent";
import { buildCustomerToolInstruction } from "@/lib/ai/customer-tools";
import { buildLanguageBlock } from "@/lib/ai/language";
import { assessConfidence } from "@/lib/ai/confidence";
import { validateReply } from "@/lib/ai/validator";
import { buildHandoffNote } from "@/lib/ai/handoff-context";
import { scanActionTokens } from "@/lib/ai/action-tokens";
import { checkSafetyGuard } from "@/lib/ai/safety-guard";
import { speak } from "@/lib/ai/speech";
import { engineSendVoiceNote } from "@/lib/flows/meta-send";
import { hasUnspeakableDetail } from "@/lib/ai/tts";
import { markdownToWhatsApp, WHATSAPP_REPLY_STYLE } from "@/lib/whatsapp/markdown-to-whatsapp";
import { selectRelevantContext, formatKnowledgeBlock } from "@/lib/ai/knowledge";
import { loadKnowledge } from "@/lib/ai/knowledge-store";
import { recordAiUsage } from "@/lib/ai/usage";
import { loadCompanyProfile, formatCompanyBlock } from "@/lib/ai/company-profile";
import { buildCustomerContext } from "@/lib/ai/customer-context";
import { pickAgent, type AgentPickStrategy } from "@/lib/flows/agent-routing";
import {
  engineSendCtaUrlButton,
  engineSendFlow,
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendTemplate,
  engineSendText,
  engineSendToNumber,
  engineSendCatalog,
} from "./meta-send";
import { decideFallback, isEscapeRequest, resolveFallbackPolicy } from "./fallback";
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
  type SendCatalogNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
  type FlowFallbackPolicy,
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

/**
 * A flow's fallback policy, held in memory for a minute.
 *
 * The escape check below runs on every inbound message of every live
 * conversation. A database round trip there would be a standing tax on
 * the hot path, paid on every message, for a setting somebody edits
 * perhaps twice a year. A minute of staleness after an edit is the
 * cheaper side of that trade — and a deploy restarts the process anyway.
 *
 * The map is never swept. One small object per flow, and an account has
 * tens of flows, not thousands.
 */
const POLICY_CACHE_TTL_MS = 60_000;
const policyCache = new Map<string, { policy: FlowFallbackPolicy; expires: number }>();

async function getFallbackPolicy(flowId: string): Promise<FlowFallbackPolicy> {
  const cached = policyCache.get(flowId);
  if (cached && cached.expires > Date.now()) return cached.policy;

  const row = await prisma.flow
    .findUnique({ where: { id: flowId }, select: { fallback_policy: true } })
    .catch(() => null);
  const policy = resolveFallbackPolicy(row?.fallback_policy ?? null);
  policyCache.set(flowId, { policy, expires: Date.now() + POLICY_CACHE_TTL_MS });
  return policy;
}

/** The text a customer actually typed, or null if they tapped something. */
function plainTextOf(message: ParsedInbound): string | null {
  return message.kind === "text" ? (message.text ?? null) : null;
}

type DigressionResult = "answered" | "handed_off" | "not_attempted";

/**
 * Let a customer ask something else mid-flow, then put them back.
 *
 * A question typed inside a form is indistinguishable, to a matcher, from
 * a wrong button — so the bot re-sends the menu and the question goes
 * unanswered. The customer's remaining options are to abandon the form or
 * ask again and watch the same menu reappear, which is how a form loses
 * somebody halfway through.
 *
 * The answer comes from the same assistant that handles messages no flow
 * claimed, so it arrives with the safety guard, the confidence gate and
 * the grounding check already applied — nothing here is a second, weaker
 * copy of those. The run does not move: the caller re-sends the prompt
 * afterwards, and the attempt is not counted as a failed reply.
 *
 * Only offered when the policy is 'reprompt'. An account that set
 * 'handoff' or 'ignore' for unmatched replies has said what it wants to
 * happen, and answering instead would be overruling it.
 */
async function tryDigression(
  run: FlowRunRow,
  message: ParsedInbound,
  policy: FlowFallbackPolicy,
): Promise<DigressionResult> {
  if (!policy.allow_digression) return "not_attempted";
  if (policy.on_unknown_reply !== "reprompt") return "not_attempted";
  if (!run.conversation_id || !run.contact_id) return "not_attempted";

  const asked = plainTextOf(message)?.trim();
  if (!asked) return "not_attempted";

  const { autoReplyToMessage } = await import("@/lib/ai/auto-reply");
  const outcome = await autoReplyToMessage({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    message: asked,
    channel: "whatsapp",
  }).catch((err: unknown) => {
    console.warn(
      "[flows] digression failed, falling back to the prompt:",
      err instanceof Error ? err.message : err,
    );
    return "failed" as const;
  });

  if (outcome === "replied") {
    await logEvent(run.id, "fallback_fired", run.current_node_key, {
      action: "digression",
      asked,
    });
    return "answered";
  }

  // The assistant decided this needed a person — low confidence, a safety
  // guard, or its own escalation topics. That decision outranks the form:
  // the run ends rather than sending the customer back to a menu they
  // have just been told somebody will call them about.
  if (outcome === "handed_off") {
    await logEvent(run.id, "handoff", run.current_node_key, {
      reason: "digression_handed_off",
      asked,
    });
    await endRun(run.id, "handed_off", "digression_handed_off");
    return "handed_off";
  }

  return "not_attempted";
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
      // header_media_url takes priority over header_text — Meta allows only
      // one header type per interactive message (see meta-api.ts).
      headerText: cfg.header_media_url
        ? undefined
        : cfg.header_text
          ? interpolateWithContact(cfg.header_text, run.vars, contact)
          : undefined,
      headerMediaUrl: cfg.header_media_url
        ? interpolateWithContact(cfg.header_media_url, run.vars, contact)
        : undefined,
      headerMediaType: cfg.header_media_url ? cfg.header_media_type : undefined,
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

type HandoffConfigShape = {
  assign_to?: string;
  note?: string;
  notify_message?: string;
  timeout_hours?: number;

  /** How the person is chosen. Absent means 'specific', which is what
   *  every chatbot built before this existed did, so their behaviour is
   *  unchanged until somebody edits the step. */
  routing_strategy?: AgentPickStrategy;
  /** Skip anyone not signed in. Ignored by 'specific' unless the step
   *  asks for it, because naming somebody is a decision. */
  only_online?: boolean;
  online_window_minutes?: number;
  /** Which roles may receive this conversation. */
  roles?: string[];
  /** Taken when the strategy finds nobody — usually a supervisor. */
  fallback_assign_to?: string;
  /** Both default on; the WhatsApp one additionally needs a message. */
  notify_push?: boolean;
  notify_whatsapp?: boolean;

  /** Sent to the customer when somebody has taken the conversation. */
  customer_message?: string;
  /** Sent to the customer when nobody could take it — everyone signed
   *  out, or the named agent gone. Kept separate from the one above
   *  because "someone is with you now" is a promise that cannot be kept
   *  at eleven at night. */
  unavailable_message?: string;
};

/** Takes the handoff config directly (not a full FlowNodeRow) so both
 *  the real `handoff` node and ai_reply's low-confidence handoff branch
 *  can call this same, single implementation — no duplicated
 *  assign/notify/push logic between "explicit handoff" and "AI wasn't
 *  confident enough" handoffs. */
async function executeHandoff(
  run: FlowRunRow,
  cfg: HandoffConfigShape,
  nodeKey: string | null,
  endReason: string = "handoff_node",
): Promise<void> {
  // Declared out here so the run log below can record what was decided
  // even when nothing was — a handoff that found nobody is exactly the
  // case somebody later needs explained.
  let assignmentSummary: { userId: string | null; reason: string } = {
    userId: null,
    reason: "this run has no conversation attached",
  };

  if (run.conversation_id) {
    // Who is actually going to answer this.
    //
    // pickAgent also covers what this used to do on its own — confirming
    // the named agent still exists, since a user deleted since the
    // chatbot was built would otherwise violate the foreign key — because
    // it only ever returns somebody it just read from this account.
    const pick = await pickAgent({
      accountId: run.account_id,
      strategy: cfg.routing_strategy ?? 'specific',
      specificUserId: cfg.assign_to ?? null,
      onlyOnline: cfg.only_online,
      onlineWindowMinutes: cfg.online_window_minutes,
      roles: cfg.roles,
      fallbackUserId: cfg.fallback_assign_to ?? null,
    }).catch((err) => {
      console.error('[handoff] agent selection failed:', err instanceof Error ? err.message : err);
      return { agent: null, reason: 'agent selection failed' };
    });
    const resolvedAgentId: string | undefined = pick.agent?.userId;
    assignmentSummary = { userId: resolvedAgentId ?? null, reason: pick.reason };

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

    if (resolvedAgentId && pick.agent) {
      const agent = pick.agent;
      const contact = run.contact_id
        ? await prisma.contact.findUnique({
            where: { id: run.contact_id },
            select: { name: true, phone: true },
          })
        : null;

      // Push notification to the assigned agent
      if (cfg.notify_push !== false) {
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
      }

      // WhatsApp notification to the agent's own number.
      //
      // The number comes from their profile now. This used to be read
      // out of the email address, which only ever worked for legacy
      // phone-login accounts — an ordinary agent with a real email and a
      // filled-in phone was silently never told.
      if (cfg.notify_message && cfg.notify_whatsapp !== false) {
        try {
          const agentPhone = agent.phone;
          if (!agentPhone) {
            // Said out loud. A notification that cannot be delivered is
            // worth one line, because the symptom otherwise is an agent
            // insisting they were never told.
            console.warn(
              `[handoff] ${agent.fullName} has no phone number on their profile, so no WhatsApp notification was sent.`,
            );
          } else {
            const waConfig = await resolveWhatsAppConfig({ accountId: run.account_id, conversationId: run.conversation_id }).catch(() => null);
            if (waConfig) {
              const lastMsg = await prisma.message.findFirst({
                // "customer" — not "contact" (this was querying a value
                // no message ever actually gets written with; every real
                // sender_type value in this codebase is customer/agent/bot).
                where: { conversation_id: run.conversation_id, sender_type: "customer" },
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
  // Told last, once the outcome is actually known — which of the two
  // messages is true depends on whether anybody was found.
  if (run.conversation_id && run.contact_id) {
    const customerText = assignmentSummary.userId
      ? cfg.customer_message
      : cfg.unavailable_message ?? cfg.customer_message;
    if (customerText?.trim()) {
      try {
        await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          text: interpolateWithContact(
            customerText,
            run.vars,
            await createContactGetter(run.contact_id).get(),
          ),
        });
      } catch (err) {
        // Never fails the handoff. The conversation has already moved to
        // a person; a customer who did not get the acknowledgement is in
        // a worse position than one who did, but a far better one than
        // if the transfer itself were rolled back over it.
        console.error(
          "[handoff] could not send the customer acknowledgement:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  await logEvent(run.id, "handoff", nodeKey, {
    note: cfg.note ?? null,
    // What was actually decided, not what the step asked for. The two
    // differ exactly when something went wrong — nobody signed in, a
    // named agent gone — which is when the run log is read.
    assigned_to: assignmentSummary.userId,
    assignment_reason: assignmentSummary.reason,
  });
  await endRun(run.id, "handed_off", endReason);
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
          bodyParams: cfg.body_params
            ? interpolateWithContact(cfg.body_params, run.vars, await getContact())
            : cfg.body_params,
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
    if (node.node_type === "send_catalog") {
      const cfg = node.config as unknown as SendCatalogNodeConfig;
      const contact = await getContact();
      try {
        const { whatsapp_message_id } = await engineSendCatalog({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          mode: cfg.mode,
          bodyText: interpolateWithContact(cfg.body_text || "", run.vars, contact),
          headerText: cfg.header_text ? interpolateWithContact(cfg.header_text, run.vars, contact) : undefined,
          footerText: cfg.footer_text ? interpolateWithContact(cfg.footer_text, run.vars, contact) : undefined,
          productRetailerId: cfg.product_retailer_id,
          productRetailerIds: cfg.product_retailer_ids,
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_catalog",
          mode: cfg.mode,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_catalog_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_catalog_failed");
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
      await executeHandoff(run, node.config as HandoffConfigShape, node.node_key);
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
      const cfg = node.config as { text?: string; header_text?: string; footer_text?: string; next_node_key?: string };
      try {
        const contactForText = await getContact();
        const headerLine = cfg.header_text
          ? interpolateWithContact(cfg.header_text, run.vars, contactForText)
          : "";
        const bodyLine = interpolateWithContact(cfg.text ?? "", run.vars, contactForText);
        const footerLine = cfg.footer_text
          ? interpolateWithContact(cfg.footer_text, run.vars, contactForText)
          : "";
        // send_text is a plain-text message on every channel (no native
        // header/footer object like interactive messages get) — a plain
        // text message type has no header field in WhatsApp's API. We
        // simulate the "bold header above the body" the builder UI
        // promises by prepending it as *bold* WhatsApp markdown; this was
        // previously silently dropped here (header_text/footer_text were
        // captured by the node form but never read from cfg at send time).
        const composedText = [
          headerLine ? `*${headerLine}*` : null,
          bodyLine,
          footerLine || null,
        ].filter(Boolean).join("\n\n");
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: composedText,
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

    // ai_reply — call the account's configured AI provider (with automatic
    // fallback to a second provider if the primary fails) and send the
    // response. Real conversation history and a relevance-filtered
    // knowledge base are built fresh below — see src/lib/ai/knowledge.ts
    // and src/lib/ai/providers/registry.ts for why.
    if (node.node_type === "ai_reply") {
      const cfg = node.config as {
        next_node_key?: string;
        /** Standardized on this key (matching what the flow-builder UI and
         *  the built-in template both write) — the previous engine read
         *  `var_key`, which nothing ever wrote, so "save the AI's reply to
         *  a variable" silently did nothing. */
        save_response_to?: string;
        /** Situational instructions for this specific step — layered on
         *  top of (never replacing) the account's persona/knowledge/
         *  guardrails below, so a per-node prompt can't accidentally
         *  discard those. */
        system_prompt?: string;
        include_history?: boolean;
        history_depth?: number;
        max_tokens?: number;
        /**
         * Whether this step reads the customer's own record — their lead
         * and its status, recent activities, follow-ups due, and earlier
         * conversations. Undefined follows the account-wide setting,
         * which is what every chatbot built before this did.
         */
        use_customer_context?: boolean;
      };
      // Hoisted above the try so the catch block can still say what the
      // customer asked when generation fails.
      const lastUserMessage =
        inboundMessage?.kind === "text" ? inboundMessage.text : "";
      try {
        const aiConfig = await prisma.aiConfig.findUnique({
          where: { account_id: run.account_id },
        });
        if (!aiConfig) {
          await logEvent(run.id, "error", node.node_key, { reason: "ai_config_not_found" });
          await endRun(run.id, "failed", "ai_config_not_found");
          return { outcome: "completed" };
        }

        // Set by the webhook once a voice note has been transcribed —
        // the customer chose to speak, so the reply should speak back.
        const inboundWasVoice =
          inboundMessage?.kind === "text" && inboundMessage.was_voice === true;

        // Real conversation history — the single biggest accuracy gap
        // this replaces: previously only the current message was ever
        // sent, with zero memory of anything said even one turn earlier.
        // Excludes the just-arrived inbound message itself (already
        // persisted by the webhook handler before the flow engine runs)
        // by its provider message id, so it isn't duplicated against
        // lastUserMessage above.
        let conversationHistory: Array<{ role: "user" | "model"; text: string }> = [];
        if (cfg.include_history !== false && run.conversation_id) {
          const depth = cfg.history_depth ?? aiConfig.history_depth_default;
          const pastMessages = await prisma.message.findMany({
            where: {
              conversation_id: run.conversation_id,
              ...(inboundMessage ? { message_id: { not: inboundMessage.meta_message_id } } : {}),
            },
            orderBy: { created_at: "desc" },
            take: depth,
            select: { sender_type: true, content_text: true },
          });
          conversationHistory = pastMessages
            .reverse()
            .filter((m): m is typeof m & { content_text: string } => Boolean(m.content_text))
            .map((m) => ({
              role: m.sender_type === "customer" ? ("user" as const) : ("model" as const),
              text: m.content_text,
            }));
        }

        // Relevance-ranked knowledge — only what's actually relevant to
        // this message, not the whole knowledge base every time. Loaded
        // from ai_knowledge_items (real rows since migration 068); the
        // loader returns the same shapes the old JSON columns did, so
        // chunking, hashing and already-synced embeddings are unaffected
        // by where it's stored.
        const { qaPairs, documents, version: knowledgeVersion } = aiConfig.knowledge_base_enabled
          // 'customer' explicitly: this is the reply a real person on
          // WhatsApp/Instagram/Messenger/RCS receives, so staff-only
          // entries must not even enter the prompt.
          ? await loadKnowledge(aiConfig.id, 'customer')
          : { qaPairs: [], documents: [], version: "off" };
        // Cache key changes whenever this account edits its knowledge
        // base — knowledge rows now change without the AiConfig row being
        // touched, so the version comes from the items themselves. A
        // burst of messages against an unchanged knowledge base reuses
        // the chunked/tokenized form instead of rebuilding it every call.
        const knowledgeCacheKey = `${aiConfig.id}:${knowledgeVersion}`;
        // Semantic (embeddings/pgvector) retrieval opts in automatically
        // whenever this account has a saved Gemini key — same BYO-key
        // model as chat replies, nothing extra to configure. No key (or
        // no embeddings synced yet) falls back to the original keyword
        // scorer inside selectRelevantContext itself; never a hard
        // dependency for this node. retrieval_mode can pin it either way:
        // 'keyword' skips the embedding call entirely, 'semantic' is the
        // same opt-in as 'auto' (selectRelevantContext still falls back
        // on a live failure rather than dropping the reply).
        const geminiKeyEntry = getProviderKeys(aiConfig).gemini;
        const geminiApiKey = geminiKeyEntry?.api_key ? decrypt(geminiKeyEntry.api_key) : null;
        const useSemantic = aiConfig.retrieval_mode !== "keyword" && !!geminiApiKey;
        const contextLimit = Math.max(1, aiConfig.max_context_results);
        // Short replies are searched together with what came just before
        // them, exactly as the auto-reply path does. "upcoming" retrieves
        // nothing on its own; after "which programme?" it retrieves the
        // programme list. Kept identical to customer-pipeline.ts on
        // purpose — a chatbot node and an unmatched message must not
        // answer the same customer differently.
        const retrievalQuery =
          lastUserMessage.trim().length <= 25 && conversationHistory.length > 0
            ? `${lastUserMessage.trim()} ${conversationHistory.slice(-2).map((h) => h.text).join(' ')}`.slice(0, 500)
            : lastUserMessage
        const selected = await selectRelevantContext(retrievalQuery, qaPairs, documents, {
          cacheKey: knowledgeCacheKey,
          // One account-level budget, split between the two kinds rather
          // than two independent caps the user can't see or reason about.
          maxQaPairs: contextLimit,
          maxDocChunks: contextLimit,
          ...(useSemantic ? { semantic: { aiConfigId: aiConfig.id, geminiApiKey: geminiApiKey! } } : {}),
        });

        // Hands the conversation to a person, with a note they can act
        // on. Used for both of the code-enforced handoffs below, so the
        // holding message and the logging stay identical between them.
        const handOverToHuman = async (note: string, reason: string) => {
          const holdingMessage =
            aiConfig.low_confidence_message?.trim() ||
            "Let me connect you with a team member who can help with that.";
          const { whatsapp_message_id } = await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: holdingMessage,
          });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "ai_reply",
            whatsapp_message_id,
            reason,
          });
          // executeHandoff logs its own "handoff" event (assign/note) —
          // the detail rides along in `note` rather than a second,
          // duplicate log call.
          await executeHandoff(
            run,
            { assign_to: aiConfig.low_confidence_assign_to ?? undefined, note },
            node.node_key,
            reason,
          );
        };

        // Requests no account should have to configure its way out of:
        // asking the assistant to reveal its instructions, asking for
        // another customer's details, or asking for a guarantee nobody
        // can give. The evaluation suite showed all of these being
        // answered happily at 0.59-0.62 confidence, because they are
        // well-formed questions that match the knowledge base — no
        // threshold catches them, and a prompt rule is exactly what the
        // first category is trying to defeat. The model is not asked.
        const safetyMatch = checkSafetyGuard(lastUserMessage);
        if (safetyMatch) {
          const { whatsapp_message_id: safetyMsgId } = await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: safetyMatch.customerMessage,
          });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "ai_reply",
            whatsapp_message_id: safetyMsgId,
            reason: `safety_${safetyMatch.category}`,
          });
          await executeHandoff(
            run,
            {
              assign_to: aiConfig.low_confidence_assign_to ?? undefined,
              note: buildHandoffNote({
                reason: "escalation_topic",
                customerMessage: lastUserMessage,
                matchedTopic: safetyMatch.reason,
              }),
            },
            node.node_key,
            "ai_reply_safety_guard",
          );
          return { outcome: "handed_off" };
        }

        // Confidence is a blend, not just retrieval similarity.
        //
        // Similarity alone is blind to the two most common ways a reply
        // goes wrong while retrieval looks healthy: a question so vague
        // it embeds close to everything, and a customer who has now
        // asked the same thing three times. Both are visible here.
        // composite_confidence_enabled falls back to the old single
        // signal, so the behaviour can be compared rather than argued
        // about.
        const recentCustomerMessages = conversationHistory
          .filter((m) => m.role === "user")
          .map((m) => m.text);
        const confidence = assessConfidence({
          retrievalConfidence: selected.confidence,
          customerMessage: lastUserMessage,
          recentCustomerMessages,
          knowledgeEmpty: selected.qaPairs.length === 0 && selected.documentChunks.length === 0,
          // A one-word answer to a question this node just asked is an
          // answer, not a vague enquiry.
          isAnsweringOurQuestion:
            conversationHistory.length > 0 &&
            conversationHistory[conversationHistory.length - 1]?.role === "model",
        });
        const effectiveConfidence = aiConfig.composite_confidence_enabled
          ? confidence.score
          : selected.confidence;

        // Code-enforced confidence guardrail — distinct from
        // fallback_answer/escalation_topics below, which are prompt-level
        // guidance the model can still ignore. This one never calls the
        // model at all when confidence is too low. Opt-in
        // (low_confidence_handoff_enabled) so existing accounts see zero
        // behavior change until the owner turns this on in Settings.
        if (aiConfig.low_confidence_handoff_enabled && effectiveConfidence < aiConfig.confidence_threshold) {
          await handOverToHuman(
            buildHandoffNote({
              reason: "low_confidence",
              customerMessage: lastUserMessage,
              confidence,
              knowledgeUsed: [
                ...selected.qaPairs.map((q) => q.question),
                ...selected.documentChunks.map((d) => d.title),
              ],
            }),
            "ai_reply_low_confidence",
          );
          return { outcome: "handed_off" };
        }

        const knowledgeBlock = formatKnowledgeBlock(selected);

        // Company details and this contact's own CRM context are loaded
        // in parallel — neither depends on the other, and this sits
        // directly in the path between a customer's message and their
        // reply, so the two round trips overlap rather than stack.
        const [companyProfile, customerContext] = await Promise.all([
          loadCompanyProfile(run.account_id).catch(() => null),
          // The step wins when it has an opinion; otherwise the account
          // setting stands. Either way there has to be a contact to look
          // the record up by.
          (cfg.use_customer_context ?? aiConfig.customer_context_enabled) && run.contact_id
            ? buildCustomerContext({
                accountId: run.account_id,
                contactId: run.contact_id,
                currentChannel: "whatsapp",
              }).catch(() => "")
            : Promise.resolve(""),
        ]);

        const promptParts = [
          // Order matters: who the business is, then who this customer
          // is, then what the assistant was told to be, then the
          // knowledge retrieved for this specific question. The model
          // reads it as context narrowing down to the task.
          formatCompanyBlock(companyProfile, "customer") || undefined,
          customerContext || undefined,
          aiConfig.system_prompt ?? undefined,
          knowledgeBlock || undefined,
        ].filter((p): p is string => Boolean(p));
        // Guardrails — prompt-level guidance, not code-enforced (an LLM
        // can still ignore an instruction; there's no second verification
        // pass here). Stated as plainly in the Settings UI copy too.
        if (aiConfig.fallback_answer) {
          promptParts.push(
            `If the knowledge above doesn't contain a confident answer to the user's question, respond with exactly: "${aiConfig.fallback_answer}" — do not guess or make up an answer.`,
          );
        }
        const escalationTopics = Array.isArray(aiConfig.escalation_topics)
          ? (aiConfig.escalation_topics as string[])
          : [];
        if (escalationTopics.length > 0) {
          promptParts.push(
            `If the user asks about any of: ${escalationTopics.join(", ")} — say a team member will follow up shortly, and don't try to answer it yourself.`,
          );
        }
        if (cfg.system_prompt) {
          promptParts.push(`Additionally, for this step: ${cfg.system_prompt}`);
        }
        // Language is worked out from what the customer actually wrote,
        // per message, rather than pinned in settings. A language chosen
        // during setup is a guess made before anybody has written in, and
        // it then overrides their real language forever after. The block
        // combines a certain signal (Unicode script) with rules for the
        // genuinely ambiguous parts — romanized Malayalam, threads that
        // mix two languages, a customer who switches mid-conversation.
        //
        // reply_language is still honoured when explicitly set, so an
        // account that deliberately wants one fixed language can have it.
        if (aiConfig.reply_language) {
          promptParts.push(
            `Always reply in ${aiConfig.reply_language}, regardless of which language the customer writes in.`,
          );
        } else {
          promptParts.push(buildLanguageBlock(lastUserMessage));
        }

        // Lookups are only offered when there is a contact to scope them
        // to. Without one there is no "this customer" to be safe about,
        // and the tools must not run at all.
        const customerToolContext = run.contact_id
          ? { accountId: run.account_id, contactId: run.contact_id }
          : null;
        if (customerToolContext) {
          promptParts.push(await buildCustomerToolInstruction(run.account_id));
        }
        // Appended last so it is the most recent instruction the model
        // reads, and applies regardless of what the account wrote above.
        promptParts.push(WHATSAPP_REPLY_STYLE);
        const systemPrompt = promptParts.join("\n\n") || "You are a helpful assistant.";

        const aiStartedAt = Date.now();
        // Routed through the customer agent so the model can look up this
        // customer's own records — their enquiry status, appointments,
        // orders — which no knowledge document can answer. Falls straight
        // back to the provider-agnostic path when the account isn't on
        // Gemini or has no contact to scope lookups to.
        const aiResult = await generateCustomerReply({
          aiConfig: { ...aiConfig, max_tokens: cfg.max_tokens ?? aiConfig.max_tokens },
          systemPrompt,
          userMessage: lastUserMessage,
          conversationHistory,
          toolContext: customerToolContext,
        });
        const { reply: rawReply, truncated } = aiResult;
        // Not awaited: this is the customer-facing reply path, and a
        // usage-analytics insert must never sit between the model
        // answering and the message going out. recordAiUsage swallows
        // its own failures (see its module header).
        void recordAiUsage({
          accountId: run.account_id,
          provider: aiResult.usedProvider,
          model: aiResult.usedModel ?? "unknown",
          feature: "chat_customer",
          tokens: aiResult.usage,
          latencyMs: Date.now() - aiStartedAt,
        });
        // Models default to standard Markdown (**bold**, # headers) —
        // WhatsApp's own dialect is different (single *bold*, no
        // headers at all) and doesn't render GitHub-flavored syntax, so
        // an unconverted reply showed literal ** and # characters to
        // real customers. Converted once here and reused below, so
        // save_response_to also stores WhatsApp-ready text rather than
        // raw Markdown a later node might re-send unconverted.
        // An account's own prompt may tell the model to append a
        // directive like [ACTION: TRIGGER_HUMAN_ADMIN]. Until now that
        // literal string was sent to the customer, because nothing knew
        // it meant anything. It is stripped here and honoured as a real
        // handoff, which is plainly what whoever wrote that instruction
        // intended. Citation artifacts from pasted PDFs ([cite: 1]) are
        // removed at the same time.
        const scanned = scanActionTokens(rawReply);
        const reply = markdownToWhatsApp(scanned.cleanedText);
        const modelAskedForHuman = scanned.actions.includes("handoff");

        // Last gate before a real person reads this.
        //
        // A model with no fee list does not say "I don't know" — it
        // produces a fluent, specific, plausible number, and the customer
        // acts on it. Prompt instructions reduce how often that happens
        // and cannot stop it. Every figure, date and contact detail in
        // the reply is checked against the material it was supposed to
        // come from; anything unsupported is a reason to fetch a person
        // rather than something to send and hope about.
        if (aiConfig.response_validation_enabled) {
          const validation = validateReply({
            reply,
            contextParts: [
              knowledgeBlock,
              customerContext,
              formatCompanyBlock(companyProfile, "customer"),
              // Tool results are legitimate sources: a price that came
              // from the catalog is supported even though it appears in
              // no knowledge document.
              ...aiResult.toolOutputs,
              // The customer's own message and the recent thread, so
              // quoting their own phone number or order number back to
              // them doesn't trip the check.
              lastUserMessage,
              ...conversationHistory.map((m) => m.text),
            ],
          });
          if (!validation.ok) {
            await logEvent(run.id, "error", node.node_key, {
              node_type: "ai_reply",
              reason: "ai_reply_blocked_unsupported_details",
              issues: validation.issues,
            });
            await handOverToHuman(
              buildHandoffNote({
                reason: "unsupported_details",
                customerMessage: lastUserMessage,
                draftReply: reply,
                validation,
                confidence,
                toolsUsed: aiResult.toolsUsed,
                knowledgeUsed: [
                  ...selected.qaPairs.map((q) => q.question),
                  ...selected.documentChunks.map((d) => d.title),
                ],
              }),
              "ai_reply_unsupported_details",
            );
            return { outcome: "handed_off" };
          }
        }

        // Answer a voice note with a voice note.
        //
        // Best-effort by design: if speech synthesis fails for any
        // reason the text reply still goes out, because a slightly wrong
        // format beats silence. Long answers stay as text regardless —
        // a spoken two-minute reply cannot be skimmed, searched or
        // screenshotted, which is exactly what someone does with fees
        // and dates.
        let voiceSent = false;
        if (
          inboundWasVoice &&
          aiConfig.voice_reply_enabled &&
          reply.length <= aiConfig.voice_max_chars
        ) {
          try {
            // Cloud TTS when the server has it — a Malayalam reply then
            // gets a Malayalam voice, and the audio arrives as a real
            // voice note rather than a file attachment. Falls back to the
            // account's own Gemini key automatically.
            const speech = await speak({
              text: reply,
              accountId: run.account_id,
              geminiApiKey,
              cloudVoice: aiConfig.cloud_voice,
              geminiVoice: aiConfig.voice_name,
            });
            const sent = await engineSendVoiceNote({
              accountId: run.account_id,
              userId: run.user_id,
              conversationId: run.conversation_id!,
              contactId: run.contact_id!,
              audio: speech.buffer,
              mimeType: speech.mimeType,
              transcript: reply,
            });
            await logEvent(run.id, "message_sent", node.node_key, {
              node_type: "ai_reply",
              whatsapp_message_id: sent.whatsapp_message_id,
              format: "voice",
              engine: speech.engine,
              language: speech.languageCode,
              ...(speech.durationSec ? { duration_sec: Math.round(speech.durationSec) } : {}),
            });
            voiceSent = true;

            // A link, a phone number or a reference cannot be heard —
            // the same reason auto-reply sends the written copy too.
            // Best effort: the answer has already arrived as audio.
            if (hasUnspeakableDetail(reply)) {
              await engineSendText({
                accountId: run.account_id,
                userId: run.user_id,
                conversationId: run.conversation_id!,
                contactId: run.contact_id!,
                text: reply,
              }).catch((textErr) =>
                console.error(
                  "[ai_reply] voice sent but the written copy failed:",
                  textErr instanceof Error ? textErr.message : textErr,
                ),
              );
            }
          } catch (err) {
            console.error(
              "[ai_reply] voice synthesis failed, sending text instead:",
              err instanceof Error ? err.message : err,
            );
          }
        }
        // `reply` still gets sent as-is otherwise — a genuine (if
        // incomplete) answer beats sending nothing, and a real customer
        // should never see an internal debug note in their WhatsApp
        // message. The truncation itself is logged below so it's
        // visible in flow-run history — an admin seeing this repeatedly
        // for one node is the signal to raise that node's Max Response
        // Tokens.
        //
        // Skipped when the same answer already went out as speech — the
        // voice message carries the text as its stored transcript, so
        // nothing is lost from the thread, and sending both would have
        // the customer read what they just listened to.
        if (!voiceSent) {
          const { whatsapp_message_id } = await engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: reply,
          });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "ai_reply",
            whatsapp_message_id,
            ...(truncated ? { truncated: true } : {}),
          });
        }
        if (cfg.save_response_to) {
          const newVars = { ...run.vars, [cfg.save_response_to]: reply };
          await prisma.flowRun.update({
            where: { id: run.id },
            data: { vars: newVars as Record<string, string> },
          });
          run = { ...run, vars: newVars };
        }

        // The model itself asked for a person, via a directive the
        // account's own prompt told it to emit.
        //
        // Handed off *after* sending, and with no holding message: the
        // instruction says to append the token **to your reply**, so the
        // reply is meant to go out. In live testing that reply was
        // "I have flagged your request — could you share your
        // registration ID?", which is genuinely useful to the customer
        // and would be thrown away by treating this like a
        // low-confidence stop. executeHandoff still assigns the
        // conversation and writes the note, so a person picks it up.
        if (modelAskedForHuman) {
          await executeHandoff(
            run,
            {
              assign_to: aiConfig.low_confidence_assign_to ?? undefined,
              note: buildHandoffNote({
                reason: "customer_requested",
                customerMessage: lastUserMessage,
                draftReply: reply,
                confidence,
                toolsUsed: aiResult.toolsUsed,
                knowledgeUsed: [
                  ...selected.qaPairs.map((q) => q.question),
                  ...selected.documentChunks.map((d) => d.title),
                ],
              }),
            },
            node.node_key,
            "ai_reply_action_token",
          );
          return { outcome: "handed_off" };
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await logEvent(run.id, "error", node.node_key, {
          reason: "ai_reply_failed",
          detail,
        });
        // Hand the conversation to a person rather than ending the run.
        //
        // Ending it sent the customer nothing at all, and the evaluation
        // suite showed exactly when that happens: an angry message
        // ("this is the third time I am asking... useless service")
        // tripped the provider's own safety filter, generation threw,
        // and the run quietly died. The customer most in need of a reply
        // was the one guaranteed to get silence. A failure here is
        // precisely when a human should be looking at the thread.
        try {
          if (run.conversation_id && run.contact_id) {
            await executeHandoff(
              run,
              {
                note:
                  buildHandoffNote({
                    reason: "low_confidence",
                    customerMessage: lastUserMessage,
                  }) + `

The assistant could not generate a reply: ${detail}`,
              },
              node.node_key,
              "ai_reply_generation_failed",
            );
            return { outcome: "handed_off" };
          }
        } catch (handoffErr) {
          console.error("[ai_reply] handoff after generation failure also failed:", handoffErr);
        }
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
        /** Meta calls this "Request data on first screen". */
        request_data?: boolean;
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
            requestData: cfg.request_data,
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
      // The way out, checked before anything else.
      //
      // Somebody halfway through a form who types "agent" is not making a
      // mistake, and treating it as one — re-sending the menu they were
      // already looking at — is how a customer learns the bot cannot be
      // escaped. This runs ahead of node matching precisely so that it
      // works from anywhere, including a node whose buttons are the only
      // thing it will normally accept.
      const typed = plainTextOf(input.message);
      if (typed) {
        const policy = await getFallbackPolicy(activeRun.flow_id);
        if (isEscapeRequest(typed, policy.escape_keywords)) {
          await executeHandoff(
            activeRun,
            {
              // Nobody planned this handoff, so there is nobody named to
              // receive it. Least-busy finds whoever is free, and online
              // is not required — an escape that finds no one because the
              // team happens to be signed out is the same as no escape.
              routing_strategy: "least_busy",
              only_online: false,
              note: `Customer asked for a person: "${typed}"`,
            },
            activeRun.current_node_key,
            "customer_asked_for_a_person",
          );
          return {
            consumed: true,
            flow_run_id: activeRun.id,
            outcome: "escaped_to_agent",
          };
        }
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

    // Did this very flow just end for this very contact?
    //
    // A flow that finishes on its first screen — a dead-end node, a
    // button whose target was deleted — matches its own trigger again on
    // the customer's next message and sends the same greeting. And again.
    // Every run looks healthy in the logs; the customer sees a bot stuck
    // on repeat.
    //
    // Declining here rather than starting is deliberate: `consumed:false`
    // hands the message on to automations and the AI auto-reply, so
    // instead of the menu for the fourth time the customer gets an actual
    // answer.
    if (input.contactId) {
      const { restart_cooldown_seconds: cooldown } = await getFallbackPolicy(flow.id);
      if (cooldown > 0) {
        const justEnded = await prisma.flowRun.findFirst({
          where: {
            flow_id: flow.id,
            contact_id: input.contactId,
            ended_at: { gte: new Date(Date.now() - cooldown * 1000) },
          },
          select: { id: true, end_reason: true },
          orderBy: { ended_at: "desc" },
        });
        if (justEnded) {
          console.warn(
            `[flows] not restarting "${flow.name}" for this contact — the previous run ` +
              `(${justEnded.id}) ended ${justEnded.end_reason ?? "for an unrecorded reason"} ` +
              `less than ${cooldown}s ago. A flow that ends this quickly usually has a ` +
              `dead end or a button pointing at a node that no longer exists.`,
          );
          return { consumed: false, outcome: "restart_suppressed" };
        }
      }
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
  // Before treating this as a wrong answer, see whether it was a
  // question — and if so, answer it. The prompt is re-sent below either
  // way, so the customer ends up back where they were.
  const digression = await tryDigression(run, message, policy);
  if (digression === "handed_off") {
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }

  // A question that got an answer is not a failed attempt, so it does not
  // spend one of the customer's reprompts. Without this, three honest
  // questions would exhaust the allowance and hand a perfectly
  // well-behaved customer to a person.
  const newReprompts =
    digression === "answered" ? run.reprompt_count : run.reprompt_count + 1;
  if (newReprompts !== run.reprompt_count) {
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { reprompt_count: newReprompts },
    });
  }

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

/**
 * Starts one chatbot for one contact, without an inbound message having
 * triggered it.
 *
 * This is how the assistant hands a conversation to a bot the business
 * already built. A customer asks where the campus is, the assistant
 * recognises that the Location Guide bot answers exactly that, and the
 * customer gets the real thing — the buttons, the map link, the photo —
 * rather than a paraphrase of it.
 *
 * Deliberately narrow. Everything the inbound path does to decide
 * *whether* a flow should run — trigger matching, keyword lists, the
 * restart cooldown — is skipped, because the decision has already been
 * made by something that read the customer's actual sentence. What is
 * not skipped is the one rule that keeps a conversation coherent: a
 * contact may have only one active run. If a bot is already running,
 * this refuses rather than queueing, because two bots talking to one
 * person is worse than either of them alone.
 */
export async function startChatbotForContact(input: {
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  flowId: string;
}): Promise<{ started: boolean; reason?: string; flow_run_id?: string }> {
  const flow = await loadFlow(input.flowId);
  if (!flow || flow.account_id !== input.accountId) {
    return { started: false, reason: "no_such_flow" };
  }
  if (!flow.entry_node_id) {
    return { started: false, reason: "no_entry_step" };
  }

  // One run per contact. The database enforces this too (the partial
  // unique index), but failing here means a sentence the caller can act
  // on instead of a P2002 to interpret.
  const active = await loadActiveRunForContact(input.accountId, input.contactId);
  if (active) return { started: false, reason: "already_in_a_chatbot" };

  const nodes = await loadAllNodes(input.flowId);
  if (nodes.size === 0) return { started: false, reason: "no_steps" };

  // startNewRun expects the message that triggered it; there isn't one.
  // A synthetic text input is honest about that — it is used only for
  // idempotency logging and for node matching that a freshly started
  // run does not reach, since the entry step has nothing to match yet.
  const result = await startNewRun(
    flow,
    {
      accountId: input.accountId,
      userId: input.userId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      message: { kind: "text", text: "", meta_message_id: `assistant:${Date.now()}` },
    },
    nodes,
  );

  return result.consumed
    ? { started: true, flow_run_id: result.flow_run_id }
    : { started: false, reason: result.outcome ?? "did_not_start" };
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
