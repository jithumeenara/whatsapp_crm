import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";

const META_API_VERSION = "v21.0";

export interface ValidateResult {
  phone: string;
  status: "valid" | "invalid" | "unknown";
  wa_id?: string;
}

/**
 * POST /api/whatsapp/validate-contacts
 * Body: { phones: string[] }
 * Calls the Meta Contacts API to check which numbers are registered on WhatsApp.
 * Processes in batches of 50 to stay within API limits.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    const body = (await req.json()) as { phones?: string[] };
    const phones = body.phones ?? [];

    if (phones.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const config = await ctx.db.whatsAppConfig.findUnique({
      where: { account_id: ctx.accountId },
    });

    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp not configured." },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.access_token);
    const phoneNumberId = config.phone_number_id;
    const results: ValidateResult[] = [];

    // Meta Contacts API accepts up to 50 numbers per request.
    const BATCH = 50;
    for (let i = 0; i < phones.length; i += BATCH) {
      const batch = phones.slice(i, i + BATCH);
      try {
        const res = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/contacts`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contacts: batch,
              blocking: "wait",
              force_check: true,
            }),
          }
        );

        if (!res.ok) {
          // If the endpoint isn't available for this account, mark all as unknown.
          const errText = await res.text();
          console.error("[validate-contacts] Meta API error:", errText);
          for (const phone of batch) {
            results.push({ phone, status: "unknown" });
          }
          continue;
        }

        const data = (await res.json()) as {
          contacts?: { input: string; status: string; wa_id?: string }[];
        };

        const byInput = new Map(
          (data.contacts ?? []).map((c) => [c.input, c])
        );

        for (const phone of batch) {
          const match = byInput.get(phone);
          results.push({
            phone,
            status:
              match?.status === "valid"
                ? "valid"
                : match?.status === "invalid"
                  ? "invalid"
                  : "unknown",
            wa_id: match?.wa_id,
          });
        }
      } catch (err) {
        console.error("[validate-contacts] batch error:", err);
        for (const phone of batch) {
          results.push({ phone, status: "unknown" });
        }
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return toErrorResponse(err);
  }
}
