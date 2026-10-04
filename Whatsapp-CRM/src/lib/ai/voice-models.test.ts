import { describe, expect, it } from "vitest";
import { decodeTtsAudio } from "./tts-audio";
import { addLiveUsage, emptyLiveUsage } from "./live-voice";
import { currentLiveModel, LIVE_MODEL } from "./live-model";

/** A real-shaped WAV: RIFF header, fmt chunk, then data. */
function wav(samples: number[], { rate = 24_000, channels = 1, bits = 16, extraChunk = false } = {}): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * channels * (bits / 8), 16);
  fmt.writeUInt16LE(channels * (bits / 8), 20);
  fmt.writeUInt16LE(bits, 22);
  // An odd-sized chunk before the data, to prove padding is honoured.
  const list = Buffer.concat([Buffer.from("LIST", "ascii"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc"), Buffer.from([0])]);
  const head = Buffer.alloc(8);
  head.write("data", 0, "ascii");
  head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([fmt, ...(extraChunk ? [list] : []), head, data]);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WAVE", 8, "ascii");
  return Buffer.concat([riff, body]);
}

describe("Gemini TTS audio", () => {
  it("reads the WAV the 3.8 voices send — samples and rate from the header, no click from it", () => {
    const out = decodeTtsAudio(wav([100, -200, 300], { rate: 24_000, extraChunk: true }), "audio/wav");
    expect(Array.from(out.pcm)).toEqual([100, -200, 300]);
    expect(out.sampleRate).toBe(24_000);
  });

  it("still reads the headerless PCM the older voices send", () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(42, 0);
    pcm.writeInt16LE(-42, 2);
    const out = decodeTtsAudio(pcm, "audio/L16;codec=pcm;rate=16000");
    expect(Array.from(out.pcm)).toEqual([42, -42]);
    expect(out.sampleRate).toBe(16_000);
  });

  it("mixes stereo down to the mono a voice note needs", () => {
    const out = decodeTtsAudio(wav([100, 300, -100, -300], { channels: 2 }), "audio/wav");
    expect(Array.from(out.pcm)).toEqual([200, -200]);
  });

  it("refuses formats it cannot play rather than producing noise", () => {
    expect(() => decodeTtsAudio(wav([1, 2], { bits: 8 }), "audio/wav")).toThrow(/cannot play/);
  });

  it("ignores an absurd rate in the mime type", () => {
    expect(decodeTtsAudio(Buffer.alloc(4), "audio/L16;rate=5").sampleRate).toBe(24_000);
  });
});

describe("live voice usage", () => {
  it("sums every report, since each turn is billed for the whole context", () => {
    const total = emptyLiveUsage();
    addLiveUsage(total, {
      promptTokenCount: 100, responseTokenCount: 50, totalTokenCount: 150,
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 90 }, { modality: "TEXT", tokenCount: 10 }],
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 50 }],
    });
    addLiveUsage(total, {
      promptTokenCount: 250, responseTokenCount: 60, thoughtsTokenCount: 20, totalTokenCount: 330,
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 240 }, { modality: "TEXT", tokenCount: 10 }],
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 60 }],
    });
    addLiveUsage(total, undefined);
    expect(total.promptTokens).toBe(350);
    expect(total.responseTokens).toBe(130);
    expect(total.totalTokens).toBe(480);
    expect(total.prompt).toEqual({ AUDIO: 330, TEXT: 20 });
    // Thinking is billed as text output.
    expect(total.response).toEqual({ AUDIO: 110, TEXT: 20 });
  });
});

describe("which live model a session uses", () => {
  it("moves the retired and restricted 2.x models to Gemini 3.8 Live", () => {
    expect(currentLiveModel("models/gemini-2.5-flash-native-audio-preview-12-2025")).toBe(LIVE_MODEL);
    expect(currentLiveModel("gemini-2.0-flash-live-001")).toBe(LIVE_MODEL);
    expect(currentLiveModel("")).toBe(LIVE_MODEL);
    expect(currentLiveModel(null)).toBe(LIVE_MODEL);
  });

  it("leaves a newer model somebody chose exactly as it is", () => {
    expect(currentLiveModel("models/gemini-3.8-live-extended-thinking")).toBe("models/gemini-3.8-live-extended-thinking");
  });
});
