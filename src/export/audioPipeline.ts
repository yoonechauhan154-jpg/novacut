import { createFile, type ISOFile } from 'mp4box';
import type { ProjectData, TimelineClip } from '../types/editor';
import {
  estimateAudioBudget,
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
  AUDIO_BYTES_PER_SAMPLE,
} from './audioBudget';

interface RawAudioSample {
  data: Uint8Array; // encoded AAC bytes
  dts: number; // decode timestamp in track timescale
  duration: number; // sample duration in track timescale
  timescale: number;
}

export interface DecodedPcm {
  channelData: Float32Array[]; // one Float32Array per channel
  sampleRate: number;
  frameCount: number;
  timestampSeconds: number;
}

const AUDIO_CODEC = 'mp4a.40.2';

/**
 * Stage 1 fix #2 — Demux only the audio samples whose decode time falls inside
 * [sourceStart, sourceEnd] using mp4box.js. Reads the whole file once (needed to
 * parse moov/stbl), then retains only the samples in the requested range.
 * Every retained sample's data is copied out and the mp4box sample reference
 * is released immediately.
 */
async function demuxAudioRange(
  mediaUrl: string,
  sourceStart: number,
  sourceEnd: number
): Promise<RawAudioSample[]> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Audio source read failed: ${response.status}`);
  }
  const fileData = await response.arrayBuffer();

  return new Promise<RawAudioSample[]>((resolve, reject) => {
    const samples: RawAudioSample[] = [];
    let timescale = AUDIO_SAMPLE_RATE;
    let settled = false;

    const file = createFile() as unknown as ISOFile;

    file.onReady = (info: any) => {
      const audioTrack = info.tracks.find((t: any) => t.type === 'sound');
      if (audioTrack) timescale = audioTrack.timescale || AUDIO_SAMPLE_RATE;
    };

    file.onSamples = (_trackId: number, sample: any, _user: any) => {
      const timeSec = sample.dts / timescale;
      if (timeSec >= sourceStart && timeSec < sourceEnd) {
        const copy = new Uint8Array(sample.data.byteLength);
        copy.set(new Uint8Array(sample.data));
        samples.push({
          data: copy,
          dts: sample.dts,
          duration: sample.duration,
          timescale,
        });
      }
      // Release the mp4box sample reference immediately.
      sample.data = null;
    };

    file.onError = () => {
      if (!settled) {
        settled = true;
        reject(new Error('mp4box demux error'));
      }
    };

    try {
      file.appendBuffer({ data: new Uint8Array(fileData), fileStart: 0 } as any);
      file.flush();
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err);
      }
    }

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(samples);
      }
    }, 0);
  });
}

/**
 * Decode encoded AAC samples using WebCodecs AudioDecoder, returning PCM chunks.
 * Each AudioData frame is copied into per-channel Float32Arrays and released.
 */
async function decodeAudioSamples(
  samples: RawAudioSample[],
  config: { codec: string; sampleRate: number; numberOfChannels: number },
  onLog: (step: string, detail: string) => void
): Promise<DecodedPcm[]> {
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('AudioDecoder unavailable');
  }

  const results: DecodedPcm[] = [];

  return new Promise<DecodedPcm[]>((resolve, reject) => {
    const decoder = new AudioDecoder({
      output: (frame: AudioData) => {
        const audioCtx = new (window as unknown as { AudioContext: new (opts: { sampleRate: number }) => AudioContext }).AudioContext({ sampleRate: frame.sampleRate });
        const buffer = audioCtx.createBuffer(
          frame.numberOfChannels,
          frame.numberOfFrames,
          frame.sampleRate
        );
        try {
          (frame as any).copyTo(buffer);
          const channelData: Float32Array[] = [];
          for (let c = 0; c < frame.numberOfChannels; c++) {
            channelData.push(buffer.getChannelData(c));
          }
          results.push({
            channelData,
            sampleRate: frame.sampleRate,
            frameCount: frame.numberOfFrames,
            timestampSeconds: frame.timestamp / 1_000_000,
          });
        } finally {
          frame.close();
          try { audioCtx.close(); } catch {}
        }
      },
      error: (e: any) => {
        if (results.length === 0) {
          reject(new Error(e.message || 'AudioDecoder error'));
        }
      },
    });

    (async () => {
      try {
        decoder.configure(config);
        for (const sample of samples) {
          const chunk = new EncodedAudioChunk({
            type: 'key',
            data: sample.data.buffer.slice(
              sample.data.byteOffset,
              sample.data.byteOffset + sample.data.byteLength
            ),
            timestamp: Math.round((sample.dts / sample.timescale) * 1_000_000),
            duration: Math.round((sample.duration / sample.timescale) * 1_000_000),
          });
          try {
            decoder.decode(chunk);
          } finally {
            // EncodedAudioChunk.close() may not exist in all type definitions.
            // The chunk is released by dropping the reference.
            sample.data = null as unknown as Uint8Array;
          }
        }
        await decoder.flush();
      } catch (err) {
        if (results.length === 0) reject(err);
      } finally {
        try { decoder.close(); } catch {}
        resolve(results);
      }
    })();
  });
}

/**
 * Apply speed, reverse, volume and fades to a PCM chunk in place.
 * Simple (non-pitch-preserving) resampling for speed changes.
 */
function applyClipTransform(
  pcm: DecodedPcm,
  clip: TimelineClip,
  _sourceStartSec: number,
  _sourceEndSec: number
): DecodedPcm {
  const { channelData, sampleRate, frameCount, timestampSeconds } = pcm;
  const speed = clip.speed ?? 1;
  const volume = Math.max(0, Math.min(2, (clip.volume ?? 100) / 100));

  // --- speed: resample by dropping/duplicating frames (pitch changes with speed) ---
  let outChannels = channelData.map((ch) => new Float32Array(ch.length));
  if (speed !== 1 && speed > 0) {
    const outLen = Math.max(1, Math.round(frameCount / speed));
    outChannels = channelData.map((ch) => {
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const srcIdx = Math.min(Math.round(i * speed), ch.length - 1);
        out[i] = ch[srcIdx];
      }
      return out;
    });
  }

  // --- reverse ---
  if (clip.reversed) {
    outChannels = outChannels.map((ch) => {
      const rev = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) rev[i] = ch[ch.length - 1 - i];
      return rev;
    });
  }

  // --- volume ---
  if (volume !== 1) {
    outChannels = outChannels.map((ch) => {
      const scaled = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) scaled[i] = ch[i] * volume;
      return scaled;
    });
  }

  // --- fades ---
  if (clip.fadeIn && clip.fadeIn > 0) {
    const fadeFrames = Math.round(clip.fadeIn * sampleRate);
    outChannels = outChannels.map((ch) => {
      const faded = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const g = i < fadeFrames ? i / fadeFrames : 1;
        faded[i] = ch[i] * g;
      }
      return faded;
    });
  }
  if (clip.fadeOut && clip.fadeOut > 0) {
    const endTime = timestampSeconds + frameCount / sampleRate;
    const fadeStart = endTime - clip.fadeOut;
    const fadeFrames = Math.round(clip.fadeOut * sampleRate);
    outChannels = outChannels.map((ch) => {
      const faded = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const t = timestampSeconds + i / sampleRate;
        const g = t >= fadeStart ? Math.max(0, (endTime - t) / clip.fadeOut) : 1;
        faded[i] = ch[i] * g;
      }
      return faded;
    });
  }

  return {
    channelData: outChannels,
    sampleRate,
    frameCount: outChannels[0]?.length ?? 0,
    timestampSeconds,
  };
}

/**
 * Stage 1 fix #2 — Render project audio as bounded PCM chunks instead of one
 * giant decoded source buffer. Only the used source ranges (sourceStart..sourceEnd
 * per clip) are demuxed and decoded. Each chunk is released by the caller after use.
 *
 * Returns { chunks, hasAudio, totalDurationSeconds, budget }.
 */
export async function renderProjectAudioChunked(
  project: ProjectData,
  onLog: (step: string, detail: string) => void
): Promise<{
  chunks: DecodedPcm[];
  hasAudio: boolean;
  totalDurationSeconds: number;
  budget: ReturnType<typeof estimateAudioBudget>;
}> {
  const budget = estimateAudioBudget(project);
  onLog(
    'audio-budget',
    `needed=${budget.neededMB.toFixed(2)}MB limit=${budget.limitMB}MB within=${budget.withinBudget} clips=${budget.perClip.length}`
  );

  const chunks: DecodedPcm[] = [];
  let hasAudio = false;
  let totalDuration = 0;

  const config = {
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
  };

  for (const clip of project.clips) {
    if (clip.trackType !== 'audio' && clip.trackType !== 'video') continue;
    if (clip.muted || clip.frozen) continue;
    if (!clip.mediaUrl) continue;

    onLog('audio-clip', `demuxing ${clip.id} sourceStart=${clip.sourceStart} sourceEnd=${clip.sourceEnd}`);

    let samples: RawAudioSample[];
    try {
      samples = await demuxAudioRange(clip.mediaUrl, clip.sourceStart, clip.sourceEnd);
    } catch (err) {
      onLog('audio-demux-failed', `${clip.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (samples.length === 0) continue;

    let decoded: DecodedPcm[];
    try {
      decoded = await decodeAudioSamples(samples, config, onLog);
    } catch (err) {
      onLog('audio-decode-failed', `${clip.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (decoded.length === 0) continue;

    hasAudio = true;
    totalDuration += clip.duration;

    for (const pcm of decoded) {
      const transformed = applyClipTransform(pcm, clip, clip.sourceStart, clip.sourceEnd);
      chunks.push(transformed);
    }
  }

  onLog('audio-render', `chunks=${chunks.length} hasAudio=${hasAudio} duration=${totalDuration.toFixed(2)}s`);
  return { chunks, hasAudio, totalDurationSeconds: totalDuration, budget };
}
