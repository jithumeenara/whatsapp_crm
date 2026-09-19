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

/**
 * "Asked again" is a claim about us, not about them.
 *
 * The signal's own wording is "previous answers have not landed", and
 * that is only true if there was a previous answer. From a live
 * handover: somebody asked in Malayalam for their email to be saved and
 * the training calendar mailed to them, the identical text was stored
 * twice with nothing from us in between, and the penalty it triggered
 * took 0.69 down to 0.57 — throwing away a reply that offered to do
 * exactly what they had asked, in favour of "let me connect you with a
 * team member". They were left waiting on a person for something the
 * assistant could have done itself.
 */
describe("repeated asking", () => {
  const QUESTION = "ഇമെയിൽ ഐഡി ഒന്ന് സേവ് ചെയ്യൂ";

  it("does not penalise the same message arriving twice", () => {
    const result = assessConfidence({
      retrievalConfidence: 0.69,
      customerMessage: QUESTION,
      recentCustomerMessages: [QUESTION],
      conversationTurns: [{ role: "user", text: QUESTION }],
    });
    expect(result.signals.map((s) => s.label)).not.toContain("Asked again");
  });

  it("still penalises a question we answered and they asked again", () => {
    const result = assessConfidence({
      retrievalConfidence: 0.69,
      customerMessage: QUESTION,
      recentCustomerMessages: [QUESTION],
      conversationTurns: [
        { role: "user", text: QUESTION },
        { role: "model", text: "ഞങ്ങൾ പരിശോധിക്കാം." },
      ],
    });
    expect(result.signals.map((s) => s.label)).toContain("Asked again");
  });

  it("counts a third unanswered-feeling ask more heavily", () => {
    const result = assessConfidence({
      retrievalConfidence: 0.69,
      customerMessage: QUESTION,
      conversationTurns: [
        { role: "user", text: QUESTION },
        { role: "model", text: "ഒന്ന്" },
        { role: "user", text: QUESTION },
        { role: "model", text: "രണ്ട്" },
      ],
    });
    expect(result.signals.map((s) => s.label)).toContain("Asked repeatedly");
  });

  it("behaves as before when the turns are not supplied", () => {
    // The evaluation suite and older callers pass only the customer's
    // side; they must keep the behaviour they were written against.
    const result = assessConfidence({
      retrievalConfidence: 0.69,
      customerMessage: QUESTION,
      recentCustomerMessages: [QUESTION],
    });
    expect(result.signals.map((s) => s.label)).toContain("Asked again");
  });
});
