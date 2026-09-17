import { describe, it, expect } from "vitest";
import { decideTurn } from "./customer-pipeline";

/**
 * What happens to a reply the model flagged for a human.
 *
 * This is worth pinning down because getting it wrong is invisible from
 * the code and obvious from a transcript. An account's prompt said:
 *
 *   "If the user wants to book a session, modify a registration, or
 *    report a technical issue, append [ACTION: TRIGGER_HUMAN_ADMIN] to
 *    your response so the backend can flag the ticket."
 *
 * The model obeyed. The token was treated as a full handoff, the reply
 * was discarded, and a customer who said "I want to register" was told
 * "let me connect you with a team member" — by an assistant that could
 * by then have registered them itself. The account had asked for a
 * ticket to be raised, not for the answer to be withheld.
 */

const ok = { ok: true, issues: [], summary: null };
const bad = {
  ok: false,
  issues: [{ kind: "number" as const, value: "3540", reason: "not in the retrieved context" }],
  summary: "1 figure the retrieved context does not support",
};

describe("decideTurn", () => {
  it("sends the reply and flags it when the model asked for a human", () => {
    const decision = decideTurn({
      validation: ok,
      modelAskedForHuman: true,
      reply: "I can register you for that. Could you tell me your name and society?",
    });
    expect(decision.action).toBe("reply");
    if (decision.action !== "reply") throw new Error("unreachable");
    expect(decision.notifyHuman).toBe(true);
    expect(decision.reply).toContain("register you");
  });

  it("hands over when the flag arrives with nothing worth sending", () => {
    // A bare acknowledgement is not an answer; sending it would be worse
    // than the holding line, and silence worse still.
    const decision = decideTurn({ validation: ok, modelAskedForHuman: true, reply: "Ok." });
    expect(decision.action).toBe("handoff");
    if (decision.action !== "handoff") throw new Error("unreachable");
    expect(decision.reason).toBe("model_requested");
  });

  it("still withholds a reply the validator could not support", () => {
    // This is the case where discarding the draft is right: the reply
    // contains a figure nothing backed up. It outranks the flag.
    const decision = decideTurn({
      validation: bad,
      modelAskedForHuman: true,
      reply: "The fee is 3540 rupees and I have flagged this for our team.",
    });
    expect(decision.action).toBe("handoff");
    if (decision.action !== "handoff") throw new Error("unreachable");
    expect(decision.reason).toBe("unsupported_details");
  });

  it("leaves an ordinary reply alone", () => {
    const decision = decideTurn({
      validation: ok,
      modelAskedForHuman: false,
      reply: "We are open from 10am to 5pm, Monday to Friday.",
    });
    expect(decision.action).toBe("reply");
    if (decision.action !== "reply") throw new Error("unreachable");
    expect(decision.notifyHuman).toBeFalsy();
  });
});
