import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPhonePeTokenCache,
  createPhonePePaymentLink,
  getPhonePeAccessToken,
  getPhonePeLinkStatus,
  parsePhonePeCredentials,
  paymentStatusFor,
  phonePePhone,
  verifyPhonePeWebhookAuth,
  type PhonePeCredentials,
} from "./phonepe";

const CREDS: PhonePeCredentials = {
  clientId: "TEST-CLIENT",
  clientSecret: "test-secret",
  clientVersion: "1",
  environment: "sandbox",
  webhookUsername: "hook-user",
  webhookPassword: "hook-password-123",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tokenReply = (expiresAtS: number) =>
  json(200, { access_token: "tok-1", expires_at: expiresAtS, token_type: "O-Bearer" });

describe("PhonePe access token", () => {
  beforeEach(() => clearPhonePeTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("asks the sandbox token URL with client credentials, form-encoded", async () => {
    const fetchMock = vi.fn(async () => tokenReply(Math.floor(Date.now() / 1000) + 3600));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPhonePeAccessToken(CREDS)).resolves.toBe("tok-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("TEST-CLIENT");
    expect(body.get("client_version")).toBe("1");
  });

  it("reuses a token until five minutes before it expires, then renews", async () => {
    const now = Date.now();
    const fetchMock = vi.fn(async () => tokenReply(Math.floor(now / 1000) + 3600));
    vi.stubGlobal("fetch", fetchMock);
    await getPhonePeAccessToken(CREDS, now);
    await getPhonePeAccessToken(CREDS, now + 30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getPhonePeAccessToken(CREDS, now + 56 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not answer a changed secret with the old secret's token", async () => {
    const fetchMock = vi.fn(async () => tokenReply(Math.floor(Date.now() / 1000) + 3600));
    vi.stubGlobal("fetch", fetchMock);
    await getPhonePeAccessToken(CREDS);
    await getPhonePeAccessToken({ ...CREDS, clientSecret: "rotated" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports PhonePe's refusal without echoing the secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { code: "UNAUTHORIZED", message: "Client not found" })));
    const err: unknown = await getPhonePeAccessToken(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Client not found");
    expect((err as Error).message).not.toContain("test-secret");
  });
});

describe("PhonePe payment link", () => {
  beforeEach(() => clearPhonePeTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  const args = {
    credentials: CREDS,
    merchantOrderId: "wa-1a2b3c4d-5e6",
    amount: 499.5,
    description: "Consultation fee",
    customerPhone: "919876543210",
    expireAt: Date.now() + 7 * 24 * 60 * 60_000,
  };

  it("sends the documented PAYLINK body in paise, with PhonePe's own SMS off", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/oauth/token")
        ? tokenReply(Math.floor(Date.now() / 1000) + 3600)
        : json(200, { orderId: "OMO1", state: "ACTIVE", expireAt: args.expireAt, paylinkUrl: "https://phon.pe/abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const link = await createPhonePePaymentLink(args);
    expect(link.paylinkUrl).toBe("https://phon.pe/abc");

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/paylinks/v1/pay");
    expect((init.headers as Record<string, string>).Authorization).toBe("O-Bearer tok-1");
    const body = JSON.parse(String(init.body));
    expect(body.merchantOrderId).toBe("wa-1a2b3c4d-5e6");
    expect(body.amount).toBe(49950);
    expect(body.paymentFlow.type).toBe("PAYLINK");
    expect(body.paymentFlow.customerDetails.phoneNumber).toBe("+919876543210");
    expect(body.paymentFlow.notificationChannels).toEqual({ SMS: false, EMAIL: false });
  });

  it("refuses an order id PhonePe would reject, before calling it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createPhonePePaymentLink({ ...args, merchantOrderId: "bad id!" })).rejects.toThrow(/merchantOrderId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an expiry beyond PhonePe's 45 days", async () => {
    await expect(
      createPhonePePaymentLink({ ...args, expireAt: Date.now() + 46 * 24 * 60 * 60_000 }),
    ).rejects.toThrow(/45 days/);
  });

  it("refuses to hand a customer a link that is not https", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/oauth/token")
          ? tokenReply(Math.floor(Date.now() / 1000) + 3600)
          : json(200, { orderId: "OMO1", state: "ACTIVE", paylinkUrl: "http://phon.pe/abc" }),
      ),
    );
    await expect(createPhonePePaymentLink(args)).rejects.toThrow(/https/);
  });
});

describe("PhonePe status", () => {
  beforeEach(() => clearPhonePeTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("reads the root state, the amount and the completed attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/oauth/token")
          ? tokenReply(Math.floor(Date.now() / 1000) + 3600)
          : json(200, {
              orderId: "OMO1",
              state: "COMPLETED",
              amount: 49950,
              newFieldPhonePeAddedLater: true,
              paymentDetails: [{ paymentMode: "UPI_QR", transactionId: "OM123", state: "COMPLETED" }],
            }),
      ),
    );
    const status = await getPhonePeLinkStatus(CREDS, "wa-1a2b3c4d-5e6");
    expect(status).toMatchObject({ state: "COMPLETED", amount: 49950, transactionId: "OM123", paymentMode: "UPI_QR" });
  });

  it("maps PhonePe's states to this app's", () => {
    expect(paymentStatusFor("COMPLETED")).toBe("completed");
    expect(paymentStatusFor("FAILED")).toBe("failed");
    expect(paymentStatusFor("EXPIRED")).toBe("failed");
    expect(paymentStatusFor("CANCELLED")).toBe("failed");
    expect(paymentStatusFor("ACTIVE")).toBe("pending");
    expect(paymentStatusFor("SOMETHING_NEW")).toBe("pending");
  });
});

describe("PhonePe webhook authentication", () => {
  const header = crypto.createHash("sha256").update("hook-user:hook-password-123").digest("hex");

  it("accepts SHA256(username:password)", () => {
    expect(verifyPhonePeWebhookAuth(header, "hook-user", "hook-password-123")).toBe(true);
    expect(verifyPhonePeWebhookAuth(header.toUpperCase(), "hook-user", "hook-password-123")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(verifyPhonePeWebhookAuth(null, "hook-user", "hook-password-123")).toBe(false);
    expect(verifyPhonePeWebhookAuth("", "hook-user", "hook-password-123")).toBe(false);
    expect(verifyPhonePeWebhookAuth(header, "hook-user", "other-password-999")).toBe(false);
    expect(verifyPhonePeWebhookAuth(header.slice(1), "hook-user", "hook-password-123")).toBe(false);
    expect(verifyPhonePeWebhookAuth(header, "", "")).toBe(false);
  });
});

describe("helpers", () => {
  it("formats phone numbers as PhonePe accepts them", () => {
    expect(phonePePhone("919876543210")).toBe("+919876543210");
    expect(phonePePhone("9876543210")).toBe("9876543210");
    expect(phonePePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("reads stored credentials, and refuses incomplete ones", () => {
    const stored = JSON.stringify({
      client_id: "C", client_secret: "S", client_version: "1", environment: "production",
      webhook_username: "u", webhook_password: "p",
    });
    expect(parsePhonePeCredentials(stored)).toMatchObject({ clientId: "C", environment: "production" });
    expect(parsePhonePeCredentials(JSON.stringify({ client_id: "C" }))).toBeNull();
    expect(parsePhonePeCredentials("not json")).toBeNull();
  });
});
