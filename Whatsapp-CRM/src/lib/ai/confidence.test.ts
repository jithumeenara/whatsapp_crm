import { describe, it, expect } from "vitest";
import { assessConfidence } from "./confidence";

/**
 * The signal that decides whether a customer keeps talking to the
 * assistant or is handed to a colleague.
 *
 * The case these tests exist for: the assistant asked "which training
 * programme would you like to register for?", the customer replied
 * "upcoming", and the reply scored as a vague enquiry — one word, almost
 * nothing to retrieve against — dropped under the handoff threshold, and
 * the customer was passed to a person in the middle of answering a
 * question the assistant had just asked them.
 *
 * Taking a registration is nine short answers in a row. Every one of
 * them would have tripped this, which made multi-turn conversation
 * impossible for exactly the feature that needs it most.
 */

const HIGH_RETRIEVAL = 0.7;

describe("assessConfidence — short replies mid-conversation", () => {
  it("does not call a one-word answer vague when it answers our question", () => {
    const answering = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "upcoming",
      isAnsweringOurQuestion: true,
    });
    expect(answering.signals.some((s) => s.label === "Very short question")).toBe(false);
  });

  it("still calls a one-word opening message vague when nothing was retrieved", () => {
    // Nothing preceded it and nothing matched it, so there is genuinely
    // nothing to read it against — the penalty is doing real work here.
    const opening = assessConfidence({
      retrievalConfidence: 0,
      customerMessage: "upcoming",
      knowledgeEmpty: true,
    });
    expect(opening.signals.some((s) => s.label === "Very short question")).toBe(true);
  });

  it("does not charge for shortness when retrieval actually found something", () => {
    // From a live WhatsApp thread: "Upcoming training" was handed to a
    // colleague and "Upcoming training programme" answered in full, off
    // the same knowledge. The only difference was a character count.
    const short = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "Upcoming training",
      knowledgeEmpty: false,
    });
    const longer = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "Upcoming training programme",
      knowledgeEmpty: false,
    });
    expect(short.signals.some((s) => s.label === "Very short question")).toBe(false);
    expect(short.score).toBe(longer.score);
  });

  it("scores an answer higher than the same words asked cold", () => {
    const answering = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "yes",
      isAnsweringOurQuestion: true,
    });
    const cold = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "yes",
    });
    expect(answering.score).toBeGreaterThan(cold.score);
  });

  it("leaves a full question alone either way", () => {
    const asQuestion = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "What is the fee for the sub staff programme in September?",
    });
    const asReply = assessConfidence({
      retrievalConfidence: HIGH_RETRIEVAL,
      customerMessage: "What is the fee for the sub staff programme in September?",
      isAnsweringOurQuestion: true,
    });
    expect(asQuestion.score).toBe(asReply.score);
  });

  it("does not rescue a short reply that retrieved nothing at all", () => {
    // The vagueness penalty is lifted; the empty-knowledge one is not.
    // "Answering a question" says the message is clear, not that the
    // assistant has anything to answer it with.
    const assessment = assessConfidence({
      retrievalConfidence: 0,
      customerMessage: "upcoming",
      isAnsweringOurQuestion: true,
      knowledgeEmpty: true,
    });
    expect(assessment.signals.some((s) => s.label === "No knowledge retrieved")).toBe(true);
  });
});
