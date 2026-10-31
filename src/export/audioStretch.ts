import type { TimelineClip } from '../types/editor';
import { clipSpeed } from '../utils/clipTiming';

/** Copy only the selected source interval; output always has exactly the timeline sample count. */
export async function stretchClipAudio(buffer: AudioBuffer, clip: TimelineClip, context: BaseAudioContext): Promise<AudioBuffer> {
  const speed = clipSpeed(clip), sr = buffer.sampleRate;
  const length = Math.max(1, Math.round(clip.duration * sr));
  const start = Math.max(0, Math.round(clip.sourceStart * sr));
  const end = Math.min(buffer.length, start + Math.round(clip.duration * speed * sr));
  if (length * buffer.numberOfChannels * 4 > 96 * 1024 * 1024) throw new Error('Speed-adjusted audio exceeds memory budget; use Android exporter');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => {
    const data = buffer.getChannelData(c).slice(start, end);
    if (clip.reversed) data.reverse();
    return data;
  });
  const worker = new Worker(new URL('./audioStretch.worker.ts', import.meta.url), { type: 'module' });
  try {
    const processed = await new Promise<Float32Array[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio time stretch timed out')), 60000);
      worker.onerror = e => { clearTimeout(timeout); reject(new Error(e.message)); };
      worker.onmessage = e => { clearTimeout(timeout); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.channels); };
      worker.postMessage({ channels, speed, length, keepPitch: clip.keepPitch !== false }, channels.map(c => c.buffer));
    });
    const out = context.createBuffer(processed.length, length, sr);
    processed.forEach((data, c) => out.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    return out;
  } finally { worker.terminate(); }
}
