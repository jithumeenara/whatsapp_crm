import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai"
import { requireRole, toErrorResponse, assertPageAccess } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { checkRateLimit } from "@/lib/rate-limit"
import { geminiCredentials } from "@/lib/ai/providers/registry"
import { recordAiUsage, tokensFromGemini } from "@/lib/ai/usage"
import { thinkingConfigFor } from "@/lib/ai/reasoning"
import { loadCompanyProfile } from "@/lib/ai/company-profile"
import { ALERT_FIELDS, ALERT_FIELD_LABEL } from "@/lib/whatsapp/alert-fields"
import { KIT_PURPOSES, normaliseKitDrafts } from "@/lib/whatsapp/template-kit"

/**
 * POST /api/whatsapp/templates/suggest  { language: "en" | "ml" | "both" }
 *
 * The AI template kit: drafts the WhatsApp templates this business is
 * likely to need — staff alerts (a customer needs a person, a new
 * contact), customer reminders for its own kind of work, one offer — from
 * the business profile. Drafts only: nothing is saved or sent to Meta
 * here; the person edits, then submits through the usual route.
 *
 * Open once WhatsApp is connected and a Gemini key is set. Supervisors and
 * above, like the Templates page; a few runs an hour (each costs tokens).
 */
const MODEL = "gemini-3.5-flash-lite"

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    templates: {
      type: SchemaType.ARRAY,
      maxItems: 12,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          purpose: { type: SchemaType.STRING, format: "enum", enum: [...KIT_PURPOSES] },
          name: { type: SchemaType.STRING, description: "lowercase_with_underscores, under 40 characters" },
          language: { type: SchemaType.STRING, format: "enum", enum: ["en", "ml"] },
          body: { type: SchemaType.STRING, description: "Template body with {{1}}, {{2}}… in order. Never start or end with a variable." },
          variables: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                field: { type: SchemaType.STRING, format: "enum", enum: [...ALERT_FIELDS], description: "Only for staff alerts." },
                sample: { type: SchemaType.STRING, description: "A realistic example value." },
              },
              required: ["sample"],
            },
          },
          why: { type: SchemaType.STRING, description: "One short line: why this business needs it." },
        },
        required: ["purpose", "name", "language", "body", "variables", "why"],
      },
    },
  },
  required: ["templates"],
} as ResponseSchema

function prompt(profile: string, languages: string[]): string {
  return [
    "You write WhatsApp Business message templates that Meta will approve, for the business described below.",
    `Write them in: ${languages.map((l) => (l === "ml" ? "Malayalam (ml)" : "English (en)")).join(" and ")} — one copy per language.`,
    "Write, for each language:",
    "- handoff_alert: sent to the business's OWN staff when the AI assistant needs a person. Variables from: " +
      ALERT_FIELDS.map((f) => `${f} (${ALERT_FIELD_LABEL[f]})`).join(", ") + ". Use customer_name, customer_phone, customer_message, and chat_link if useful.",
    "- new_contact_alert: sent to staff when a new customer messages for the first time (same variable list, no reason).",
    "- 2 to 4 customer_utility templates this kind of business really sends (appointment or class reminders, fee or payment due, report ready, order update…).",
    "- 1 customer_marketing template (an event or offer suited to the business).",
    "Rules Meta enforces: variables are {{1}}, {{2}}… in order; a variable never starts or ends the text and two are never side by side; enough words around each variable;",
    "utility templates contain NO promotion (no offer, discount, free); be polite and specific; under 600 characters; no emojis in alerts; plain text, no links except a chat_link variable.",
    "For staff alerts, set each variable's 'field'. Give a realistic 'sample' for every variable.",
    "",
    "BUSINESS:",
    profile || "(no profile filled in — write generic templates for a small service business)",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("supervisor")
    assertPageAccess(ctx, "/templates")
    const rl = checkRateLimit(`template-kit:${ctx.accountId}`, { limit: 6, windowMs: 60 * 60_000 })
    if (!rl.success) return NextResponse.json({ error: "The template kit was used several times this hour. Try again later." }, { status: 429 })

    const body = await req.json().catch(() => null)
    const lang = body?.language
    const languages = lang === "ml" ? ["ml"] : lang === "both" ? ["en", "ml"] : ["en"]

    const [wa, aiCfg, profile, existing] = await Promise.all([
      prisma.whatsAppConfig.findFirst({ where: { account_id: ctx.accountId }, select: { id: true } }),
      prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { provider_keys: true } }),
      loadCompanyProfile(ctx.accountId).catch(() => null),
      prisma.messageTemplate.findMany({ where: { account_id: ctx.accountId }, select: { name: true } }),
    ])
    if (!wa) return NextResponse.json({ error: "Connect WhatsApp first (Settings → Channels)." }, { status: 400 })
    const { apiKey } = geminiCredentials({ provider_keys: aiCfg?.provider_keys ?? null })
    if (!apiKey) return NextResponse.json({ error: "Add a Gemini API key first (Settings → AI)." }, { status: 400 })

    const profileText = profile
      ? [
          profile.display_name || profile.legal_name,
          [profile.category, profile.category_other, profile.section, profile.section_other].filter(Boolean).join(" / "),
          profile.about,
          profile.services ? `Services: ${profile.services}` : null,
          [profile.city, profile.state, profile.country].filter(Boolean).join(", "),
        ].filter(Boolean).join("\n").slice(0, 3000)
      : ""

    const started = Date.now()
    let raw: unknown
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: MODEL,
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, ...(thinkingConfigFor(MODEL, "low") ?? {}) },
      })
      const result = await model.generateContent(prompt(profileText, languages))
      void recordAiUsage({ accountId: ctx.accountId, model: MODEL, feature: "template_kit", tokens: tokensFromGemini(result.response.usageMetadata), latencyMs: Date.now() - started })
      raw = JSON.parse(result.response.text())
    } catch (err) {
      console.error("[template-kit] model failed:", err instanceof Error ? err.message : err)
      return NextResponse.json({ error: "The AI could not write templates just now. Try again in a minute." }, { status: 502 })
    }

    const drafts = normaliseKitDrafts(raw, existing.map((t) => t.name))
    return NextResponse.json({ drafts })
  } catch (err) {
    return toErrorResponse(err)
  }
}
