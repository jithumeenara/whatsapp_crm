import { describe, it, expect } from "vitest";

import { stripForSpeech, speakNumbers, hasUnspeakableDetail } from "./tts";

/**
 * What a reply sounds like when it is read out.
 *
 * Every case here came from a customer actually hearing it. They share
 * one shape: the text was correct, and the engine was handed characters
 * meant for a screen and guessed at what they stood for. A screen shows
 * *ACSTI Kerala* in bold; a voice says "star ACSTI Kerala star". A
 * screen shows ₹3,540; a voice, reading the comma as a decimal point,
 * says three rupees fifty-four paise — a hundredth of the fee.
 *
 * The wrong number is the serious one. A customer who hears an asterisk
 * knows something is off. A customer who hears the wrong fee does not.
 */

describe("formatting must not be read aloud", () => {
  it("drops WhatsApp's bold, italic and strike markers", () => {
    expect(stripForSpeech("*ACSTI Kerala* welcomes you")).toBe("ACSTI Kerala welcomes you");
    expect(stripForSpeech("_Admissions_ are open")).toBe("Admissions are open");
    expect(stripForSpeech("~cancelled~ rescheduled")).toBe("cancelled rescheduled");
  });

  it("drops them in Malayalam too", () => {
    expect(stripForSpeech("*എ.സി.എസ്.ടി.ഐ* കേരള")).toBe("എ.സി.എസ്.ടി.ഐ കേരള");
  });

  it("turns a bullet list into pauses, not the word dash", () => {
    const out = stripForSpeech("Programmes:\n- STP\n- Basic Banking");
    expect(out).not.toContain("-");
    expect(out).toContain("STP");
    expect(out).toContain("Basic Banking");
  });
});

describe("numbers must be said the way they are written", () => {
  it("does not let a grouping comma become a decimal point", () => {
    // The live failure: "₹3,540" read as three rupees fifty-four paise.
    expect(speakNumbers("₹3,540")).toBe("3540 rupees");
    expect(speakNumbers("The fee is 12,500 for the full course")).toContain("12500");
  });

  it("handles Indian grouping, which is where most engines give up", () => {
    expect(speakNumbers("₹3,54,000")).toBe("354000 rupees");
  });

  it("leaves an ordinary comma alone", () => {
    // A comma between words is punctuation and the pause it produces is
    // wanted. Only a comma wedged between two digits is a separator.
    expect(speakNumbers("Kochi, Kerala")).toBe("Kochi, Kerala");
    expect(speakNumbers("Bring a pen, a copy, and 2 photos")).toContain("pen, a copy");
  });

  it("says the currency after the amount, where people say it", () => {
    expect(speakNumbers("Rs. 500")).toBe("500 rupees");
    expect(speakNumbers("Rs 500")).toBe("500 rupees");
    expect(speakNumbers("INR 500")).toBe("500 rupees");
    expect(speakNumbers("500 ₹")).toBe("500 rupees");
  });

  it("keeps the paise when there are any", () => {
    expect(speakNumbers("₹3,540.50")).toBe("3540.50 rupees");
  });

  it("says percent rather than leaving a symbol to chance", () => {
    expect(speakNumbers("18% GST")).toBe("18 percent GST");
  });

  it("does not split a decimal into two numbers", () => {
    // The old sentence-splitting rule read "4.5" as "4. 5"; the guard
    // against it is that a stop only ends a sentence before a capital.
    expect(stripForSpeech("The duration is 4.5 days")).toContain("4.5 days");
  });
});

describe("what cannot be heard at all", () => {
  it("knows a link when it sees one", () => {
    expect(hasUnspeakableDetail("Apply at https://acsti.in/apply")).toBe(true);
    expect(hasUnspeakableDetail("See www.acsti.in for details")).toBe(true);
  });

  it("knows a phone number, which nobody can write down from one listen", () => {
    expect(hasUnspeakableDetail("Call 9847012345")).toBe(true);
    expect(hasUnspeakableDetail("Call 0471 234 5678")).toBe(true);
  });

  it("knows an email address", () => {
    expect(hasUnspeakableDetail("Write to office@acsti.in")).toBe(true);
  });

  it("does not call an ordinary sentence unspeakable", () => {
    // A price, a date, a duration — all perfectly sayable, and sending
    // a duplicate text for every one of them would be noise.
    expect(hasUnspeakableDetail("The fee is 3540 rupees")).toBe(false);
    expect(hasUnspeakableDetail("It runs from 1 October to 5 October")).toBe(false);
    expect(hasUnspeakableDetail("There are 30 seats")).toBe(false);
  });

  it("promises the written copy, since one is now actually sent", () => {
    const out = stripForSpeech("Apply at https://acsti.in/apply today");
    expect(out).not.toContain("https");
    expect(out).toContain("the link in the message below");
  });
});
