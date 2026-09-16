import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { derivePublicInfo, normalizePem } from "./key-material";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("derivePublicInfo", () => {
  // The regression that started it all. `privateKeyObject.export({ type:
  // "spki" })` throws "The property 'options.type' is invalid" on every
  // call — and because the caller swallowed it and said "No key
  // configured", the owner generated replacement after replacement,
  // uploading a new public key to Meta each time and breaking every
  // published Flow, for weeks, with nothing anywhere saying why.
  it("returns the public half of a private key rather than throwing", () => {
    expect(() => derivePublicInfo(privateKey)).not.toThrow();
  });

  it("derives exactly the public key that belongs to it", () => {
    expect(derivePublicInfo(privateKey).publicKey.trim()).toBe(publicKey.trim());
  });

  it("gives a stable fingerprint over the public half", () => {
    const a = derivePublicInfo(privateKey);
    const b = derivePublicInfo(privateKey);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/);
  });

  it("reads a key however it was stored", () => {
    const expected = derivePublicInfo(privateKey).fingerprint;
    // Single line with \n escapes — how it lands in an env var.
    const escaped = privateKey.replace(/\n/g, String.fromCharCode(92) + "n");
    // Windows line endings — how it lands via copy-paste.
    const crlf = privateKey.replace(/\n/g, "\r\n");
    // Body unwrapped entirely — how it lands out of some editors.
    const unwrapped = privateKey
      .replace(/-----BEGIN PRIVATE KEY-----\n/, "-----BEGIN PRIVATE KEY-----")
      .replace(/\n-----END PRIVATE KEY-----/, "-----END PRIVATE KEY-----")
      .replace(/\n/g, "");

    for (const variant of [escaped, crlf, unwrapped]) {
      expect(derivePublicInfo(variant).fingerprint).toBe(expected);
    }
  });

  it("throws on something that is not a private key, rather than returning nonsense", () => {
    // The caller has to be able to tell "unusable" from "absent" — those
    // need opposite advice, and conflating them is what caused the loop.
    expect(() => derivePublicInfo("not a key")).toThrow();
    expect(() => derivePublicInfo(publicKey)).toThrow();
  });
});

describe("normalizePem", () => {
  it("leaves an already-correct PEM alone", () => {
    expect(normalizePem(privateKey)).toBe(privateKey.trim());
  });

  it("wraps the body back to 64 columns", () => {
    const squashed = privateKey.replace(/\n/g, "");
    const lines = normalizePem(squashed).split("\n");
    expect(lines[0]).toBe("-----BEGIN PRIVATE KEY-----");
    expect(lines[lines.length - 1]).toBe("-----END PRIVATE KEY-----");
    for (const line of lines.slice(1, -1)) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
  });

  it("passes through text with no PEM markers untouched", () => {
    expect(normalizePem("  hello  ")).toBe("hello");
  });
});
