/// <reference lib="webworker" />
export {};
/** WSOLA: match overlapping waveform phases, share alignment across stereo channels.
 * All CPU work runs off the UI thread. No per-video-frame pixel reads. */
self.onmessage = (event: MessageEvent<{ channels: Float32Array[]; speed: number; length: number; keepPitch: boolean }>) => {
  try {
    const { channels, speed, length, keepPitch } = event.data;
    const output = channels.map(() => new Float32Array(length));
    const inputLength = channels[0].length;
    if (!keepPitch || Math.abs(speed - 1) < .00001) {
      for (let c = 0; c < channels.length; c++) for (let i = 0; i < length; i++) {
        const at = i * speed, a = Math.floor(at), frac = at - a;
        output[c][i] = (channels[c][a] || 0) * (1 - frac) + (channels[c][a + 1] || 0) * frac;
      }
    } else {
      const window = 1024, hop = 512, search = 256;
      let previous = 0;
      for (let pos = 0; pos < length; pos += hop) {
        const expected = Math.round(pos * speed);
        let best = Math.min(Math.max(0, expected), Math.max(0, inputLength - window));
        if (pos > 0) {
          let bestScore = -Infinity;
          const center = best;
          // Compare downsampled overlap; bounded search rather than quadratic whole-file matching.
          for (let candidate = Math.max(0, center - search); candidate <= Math.min(inputLength - window, center + search); candidate += 4) {
            let dot = 0, aa = 1e-10, bb = 1e-10;
            for (let j = 0; j < hop; j += 8) {
              const a = channels[0][previous + hop + j] || 0, b = channels[0][candidate + j] || 0;
              dot += a * b; aa += a * a; bb += b * b;
            }
            const score = dot / Math.sqrt(aa * bb);
            if (score > bestScore) { bestScore = score; best = candidate; }
          }
        }
        for (let c = 0; c < channels.length; c++) for (let j = 0; j < window && pos + j < length; j++) {
          const sample = channels[c][best + j] || 0;
          if (pos === 0 || j >= hop) output[c][pos + j] = sample;
          else { const fade = j / hop; output[c][pos + j] = output[c][pos + j] * (1 - fade) + sample * fade; }
        }
        previous = best;
      }
    }
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ channels: output }, output.map(c => c.buffer));
  } catch (error) { self.postMessage({ error: String(error) }); }
};
