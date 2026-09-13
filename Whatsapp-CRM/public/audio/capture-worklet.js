/**
 * Microphone capture for the live voice console.
 *
 * Served as a real file rather than built from a Blob URL at runtime,
 * because this app's own Content-Security-Policy sets
 * `script-src 'self' ...` with no `blob:`. A worklet module loaded from
 * a blob: URL is therefore blocked, and AudioWorklet reports a module it
 * could not load as an AbortError — "the microphone stopped responding",
 * which points nowhere near a CSP.
 *
 * The alternative was adding `blob:` to script-src, which would permit
 * blob-sourced scripts across the whole application to save one file.
 * Not worth it.
 *
 * Do not delete: src/components/settings/ai/use-live-voice.ts loads this
 * path, and voice replies stop working without it.
 *
 * Posts each block as 16-bit PCM plus its loudness, so voice-activity
 * detection on the main thread needs no second analyser reading the same
 * stream.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const pcm = new Int16Array(channel.length);
    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      sumSquares += clamped * clamped;
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    this.port.postMessage(
      { pcm: pcm.buffer, rms: Math.sqrt(sumSquares / channel.length) },
      [pcm.buffer],
    );
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
