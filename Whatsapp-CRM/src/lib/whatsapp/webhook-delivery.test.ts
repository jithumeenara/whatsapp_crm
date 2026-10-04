import { beforeEach, describe, expect, it } from "vitest";
import { deliveryVerdict, sameEndpoint, webhookUrlFor, type DeliveryFacts } from "./webhook-delivery";
import { deliveryRecord, noteDelivered, noteRejected, resetWebhookHealth } from "./webhook-health";

const OURS = "https://leads.example.org/api/whatsapp/webhook";
const START = "2026-10-04T10:00:00.000Z";

function facts(over: Partial<DeliveryFacts> = {}): DeliveryFacts {
  return {
    ourUrl: OURS,
    route: { application: OURS },
    app: { id: "111", name: "CRM app" },
    appSubscription: { callbackUrl: OURS, messages: true, active: true },
    secretMatchesApp: true,
    secretsConfigured: 1,
    ourAppOnWaba: true,
    record: { since: START, lastDeliveredAt: null, rejected: null },
    ...over,
  };
}

describe("where a number's messages go", () => {
  it("waits for a first message when everything points here", () => {
    const r = deliveryVerdict(facts());
    expect(r.status).toBe("waiting");
    expect(r.issues).toEqual([]);
    expect(r.via).toBe("application");
  });

  it("reports messages arriving once a signed webhook came in", () => {
    const r = deliveryVerdict(facts({ record: { since: START, lastDeliveredAt: "2026-10-04T10:05:00.000Z", rejected: null } }));
    expect(r.status).toBe("receiving");
  });

  it("spots a Meta app shared with another site, and offers the fix", () => {
    const r = deliveryVerdict(facts({ route: { application: "https://other-client.example.com/api/whatsapp/webhook" } }));
    expect(r.status).toBe("blocked");
    expect(r.issues[0]).toBe("elsewhere");
    expect(r.canFix).toBe(true);
    expect(r.effectiveUrl).toBe("https://other-client.example.com/api/whatsapp/webhook");
  });

  it("follows Meta's order: the number's own address beats the account's and the app's", () => {
    const r = deliveryVerdict(facts({
      route: { phone_number: OURS, whatsapp_business_account: "https://old-provider.example.net/hook", application: "https://x.example/hook" },
    }));
    expect(r.via).toBe("phone_number");
    expect(r.issues).toEqual([]);
    const left = deliveryVerdict(facts({ route: { whatsapp_business_account: "https://old-provider.example.net/hook", application: OURS } }));
    expect(left.via).toBe("whatsapp_business_account");
    expect(left.issues[0]).toBe("elsewhere");
  });

  it("names a missing address, a missing messages field and an unsubscribed account", () => {
    expect(deliveryVerdict(facts({ route: {} })).issues).toContain("no_callback");
    expect(deliveryVerdict(facts({ appSubscription: { callbackUrl: OURS, messages: false, active: true } })).issues).toContain("messages_off");
    const r = deliveryVerdict(facts({ ourAppOnWaba: false }));
    expect(r.issues[0]).toBe("not_subscribed");
    expect(r.canFix).toBe(true);
  });

  it("says when this server's App Secret is not the sending app's — the fix is on the server, not a button", () => {
    const r = deliveryVerdict(facts({ secretMatchesApp: false }));
    expect(r.issues).toEqual(["secret_mismatch"]);
    expect(r.canFix).toBe(false);
    expect(deliveryVerdict(facts({ secretsConfigured: 0, secretMatchesApp: null })).issues).toEqual(["no_secret"]);
  });

  it("treats refused deliveries after the last good one as a secret problem", () => {
    const r = deliveryVerdict(facts({
      secretMatchesApp: null,
      record: { since: START, lastDeliveredAt: null, rejected: { at: "2026-10-04T10:03:00.000Z", reason: "mismatch", count: 4 } },
    }));
    expect(r.status).toBe("blocked");
    expect(r.issues).toEqual(["secret_mismatch"]);
  });

  it("believes evidence over addresses: delivered here means the route works", () => {
    const r = deliveryVerdict(facts({
      route: { application: "https://alias.example.com/api/whatsapp/webhook" },
      record: { since: START, lastDeliveredAt: "2026-10-04T10:05:00.000Z", rejected: null },
    }));
    expect(r.status).toBe("receiving");
  });

  it("says it could not check rather than guessing", () => {
    const r = deliveryVerdict(facts({ route: null, routeError: "Unsupported get request", appSubscription: null, secretMatchesApp: null, ourAppOnWaba: null }));
    expect(r.status).toBe("unknown");
    expect(r.routeError).toBe("Unsupported get request");
  });
});

describe("addresses", () => {
  it("treats www and a trailing slash as the same endpoint, and nothing else", () => {
    expect(sameEndpoint("https://www.leads.example.org/api/whatsapp/webhook/", OURS)).toBe(true);
    expect(sameEndpoint("https://LEADS.example.org/api/whatsapp/webhook", OURS)).toBe(true);
    expect(sameEndpoint("https://leads.example.org/api/webhook", OURS)).toBe(false);
    expect(sameEndpoint("https://evil.example/api/whatsapp/webhook", OURS)).toBe(false);
    expect(sameEndpoint("not a url", OURS)).toBe(false);
  });

  it("only ever offers Meta a public https host of this site", () => {
    expect(webhookUrlFor("https://leads.example.org")).toBe(OURS);
    expect(webhookUrlFor("http://leads.example.org")).toBeNull();
    expect(webhookUrlFor("https://localhost:3000")).toBeNull();
    expect(webhookUrlFor("https://127.0.0.1")).toBeNull();
    expect(webhookUrlFor("https://[::1]")).toBeNull();
    expect(webhookUrlFor("https://intranet")).toBeNull();
    expect(webhookUrlFor("")).toBeNull();
  });
});

describe("the delivery record", () => {
  beforeEach(() => resetWebhookHealth(Date.parse(START)));

  it("remembers our business numbers only, from genuine webhooks", () => {
    noteDelivered({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" } } }] }] }, Date.parse("2026-10-04T10:01:00Z"));
    noteDelivered({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "<script>" } } }] }] });
    noteDelivered("garbage");
    expect(deliveryRecord("1234567890").lastDeliveredAt).toBe("2026-10-04T10:01:00.000Z");
    expect(deliveryRecord("<script>").lastDeliveredAt).toBeNull();
  });

  it("counts refused deliveries, but not requests that were never Meta's", () => {
    noteRejected("no_signature");
    expect(deliveryRecord("1").rejected).toBeNull();
    noteRejected("mismatch", Date.parse("2026-10-04T10:02:00Z"));
    noteRejected("mismatch", Date.parse("2026-10-04T10:03:00Z"));
    expect(deliveryRecord("1").rejected).toEqual({ at: "2026-10-04T10:03:00.000Z", reason: "mismatch", count: 2 });
  });
});
