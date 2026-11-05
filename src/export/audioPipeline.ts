import { createFile, type ISOFile } from 'mp4box';
import type { ProjectData, TimelineClip } from '../types/editor';
import { getAudioExtractorPlugin } from '../utils/androidBridge';
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

// ---------------------------------------------------------------------------
// Audio pipeline step tracer — every step is logged so a phone failure shows
// exactly where the chain broke (mp4box parse → track found → sample count →
// AudioDecoder config → first decoded chunk → mixing → AudioEncoder config).
// ---------------------------------------------------------------------------
export interface AudioPipelineTrace {
  steps: string[];
  demuxedSamples: number;
  decodedFrames: number;
  audioSpecificConfig?: string; // hex of the esds/AudioSpecificConfig bytes
  skipReason?: string;
}

const AUDIO_CODEC = 'mp4a.40.2';

/** Build a 2-byte AudioSpecificConfig for AAC LC from sampleRate + channel count. */
function buildAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  let samplingFrequencyIndex: number;
  switch (sampleRate) {
    case 96000: samplingFrequencyIndex = 0; break;
    case 88200: samplingFrequencyIndex = 1; break;
    case 64000: samplingFrequencyIndex = 2; break;
    case 48000: samplingFrequencyIndex = 3; break;
    case 44100: samplingFrequencyIndex = 4; break;
    case 32000: samplingFrequencyIndex = 5; break;
    case 24000: samplingFrequencyIndex = 6; break;
    case 22050: samplingFrequencyIndex = 7; break;
    case 16000: samplingFrequencyIndex = 8; break;
    case 12000: samplingFrequencyIndex = 9; break;
    case 11025: samplingFrequencyIndex = 10; break;
    case 8000:  samplingFrequencyIndex = 11; break;
    default:    samplingFrequencyIndex = 3; break; // fall back to 48 kHz
  }
  const audioObjectType = 2; // AAC LC
  const chanCfg = channels === 1 ? 1 : channels === 2 ? 2 : channels;
  const b1 = (audioObjectType << 3) | (samplingFrequencyIndex >> 1);
  const b2 = ((samplingFrequencyIndex & 1) << 7) | (chanCfg << 3);
  return new Uint8Array([b1, b2]);
}

/** Try to read the AudioSpecificConfig (esds) from an mp4box-parsed audio track. */
function extractAudioSpecificConfig(audioTrack: any): Uint8Array | undefined {
  try {
    // mp4box stores the sample description box (stsd) under trak.mdia.minf.stbl.stsd
    const stsd = audioTrack.box?.mdia?.minf?.stbl?.stsd;
    if (!stsd?.entries) return undefined;
    for (const entry of stsd.entries) {
      // mp4aSampleEntry has esds (esdsBox) which contains ES_Descriptor → decoderSpecificInfo
      if (entry.esds) {
        const esd = entry.esds;
        const dsi = esd.decoderConfig?.decoderSpecificInfo;
        if (dsi) return new Uint8Array(dsi);
        // esdsBox itself may hold config directly
        if (esd.config) return new Uint8Array(esd.config);
      }
      if (entry.esdss?.[0]) {
        const esd = entry.esdss[0];
        const dsi = esd.decoderConfig?.decoderSpecificInfo;
        if (dsi) return new Uint8Array(dsi);
        if (esd.config) return new Uint8Array(esd.config);
      }
    }
  } catch { /* best-effort extraction */ }
  return undefined;
}

function hex(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined;
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stage 1 fix #2 — Demux only the audio samples whose decode time falls inside
 * [sourceStart, sourceEnd] using mp4box.js. Reads the whole file once (needed to
 * parse moov/stbl), then retains only the samples in the requested range.
 * Every retained sample's data is copied out and the mp4box sample reference
 * is released immediately.
 *
 * Returns { samples, audioSpecificConfig, timescale }.
 */
async function demuxAudioRange(
  mediaUrl: string,
  sourceStart: number,
  sourceEnd: number,
  onLog: (step: string, detail: string) => void
): Promise<{ samples: RawAudioSample[]; audioSpecificConfig?: Uint8Array; timescale: number }> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Audio source read failed: HTTP ${response.status}`);
  }
  const fileData = await response.arrayBuffer();
  onLog('audio-demux-fetch', `fetched ${fileData.byteLength} bytes from ${mediaUrl}`);

  return new Promise<{ samples: RawAudioSample[]; audioSpecificConfig?: Uint8Array; timescale: number }>((resolve, reject) => {
    const samples: RawAudioSample[] = [];
    let timescale = AUDIO_SAMPLE_RATE;
    let audioSpecificConfig: Uint8Array | undefined;
    let settled = false;

    const file = createFile() as unknown as ISOFile;

    file.onReady = (info: any) => {
      const audioTrack = info.tracks.find((t: any) => t.type === 'sound');
      if (audioTrack) {
        timescale = audioTrack.timescale || AUDIO_SAMPLE_RATE;
        onLog('audio-demux-track', `found audio track id=${audioTrack.id} timescale=${timescale} codec=${audioTrack.codec} sampleRate=${audioTrack.audio?.sample_rate} channels=${audioTrack.audio?.channel_count} nb_samples=${audioTrack.nb_samples}`);
        // Extract AudioSpecificConfig (esds) from the mp4box track box structure.
        const esc = extractAudioSpecificConfig(audioTrack);
        if (esc) {
          audioSpecificConfig = esc;
          onLog('audio-demux-esds', `AudioSpecificConfig extracted: ${hex(esc)}`);
        } else {
          // Best-effort: build from track properties.
          const sr = audioTrack.audio?.sample_rate || AUDIO_SAMPLE_RATE;
          const ch = audioTrack.audio?.channel_count || AUDIO_CHANNELS;
          audioSpecificConfig = buildAudioSpecificConfig(sr, ch);
          onLog('audio-demux-esds-fallback', `AudioSpecificConfig built: ${hex(audioSpecificConfig)} (sr=${sr} ch=${ch})`);
        }
      } else {
        onLog('audio-demux-track', 'no audio track found in mp4box info');
      }
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
      file.appendBuffer({ data: fileData, fileStart: 0 } as any);
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
        onLog('audio-demux-done', `samples=${samples.length} range=[${sourceStart},${sourceEnd})`);
        resolve({ samples, audioSpecificConfig, timescale });
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
  config: { codec: string; sampleRate: number; numberOfChannels: number; description?: Uint8Array },
  onLog: (step: string, detail: string) => void
): Promise<DecodedPcm[]> {
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('AudioDecoder unavailable');
  }

  // Check decoder support before configuring.
  const decoderConfig = { codec: config.codec, sampleRate: config.sampleRate, numberOfChannels: config.numberOfChannels };
  if (config.description) {
    (decoderConfig as any).description = config.description;
  }
  const supported = await AudioDecoder.isConfigSupported(decoderConfig as any);
  onLog('audio-decoder-config', `isConfigSupported=${supported.supported} codec=${config.codec} sr=${config.sampleRate} ch=${config.numberOfChannels} desc=${config.description ? hex(config.description) : 'none'}`);
  if (!supported.supported) {
    throw new Error(`AudioDecoder does not support ${config.codec} sr=${config.sampleRate} ch=${config.numberOfChannels}`);
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
          onLog('audio-decoded-chunk', `frames=${frame.numberOfFrames} sr=${frame.sampleRate} ch=${frame.numberOfChannels} totalDecodedFrames=${results.reduce((a, b) => a + b.frameCount, 0)}`);
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
        decoder.configure(decoderConfig as any);
        let decodedCount = 0;
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
            decodedCount++;
          } finally {
            sample.data = null as unknown as Uint8Array;
          }
        }
        onLog('audio-decoder-decode', `decoded chunks sent=${decodedCount}`);
        await decoder.flush();
      } catch (err) {
        if (results.length === 0) reject(err);
      } finally {
        try { decoder.close(); } catch {}
        onLog('audio-decoder-done', `decodedFrames=${results.length} totalPCMFrames=${results.reduce((a, b) => a + b.frameCount, 0)}`);
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

  if (clip.reversed) {
    outChannels = outChannels.map((ch) => {
      const rev = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) rev[i] = ch[ch.length - 1 - i];
      return rev;
    });
  }

  if (volume !== 1) {
    outChannels = outChannels.map((ch) => {
      const scaled = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) scaled[i] = ch[i] * volume;
      return scaled;
    });
  }

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
 * Native audio fallback (Android only): uses MediaExtractor + MediaMuxer to
 * extract only the used audio time range as a small M4A file (no re-encoding),
 * then decodes it with decodeAudioData into PCM. Called when WebCodecs
 * AudioDecoder is unavailable or produces no output.
 */
async function decodeViaNativeExtractor(
  mediaUrl: string,
  sourceStart: number,
  sourceEnd: number,
  onLog: (step: string, detail: string) => void
): Promise<DecodedPcm[]> {
  const extractor = getAudioExtractorPlugin();
  if (!extractor) {
    throw new Error('AudioExtractor plugin unavailable (not on Android)');
  }
  onLog('audio-native-fallback', `extracting ${mediaUrl} [${sourceStart},${sourceEnd})`);
  const result = await extractor.extractAudioRange({ mediaUrl, sourceStart, sourceEnd });
  onLog('audio-native-fetched', `extracted ${result.size} bytes, ${result.samples} samples, uri=${result.uri}`);

  const response = await fetch(result.uri);
  if (!response.ok) throw new Error(`AudioExtractor fetch failed: HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();

  const audioCtx = new (window as unknown as { AudioContext: new () => AudioContext }).AudioContext();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  try {
    const channelData: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channelData.push(buffer.getChannelData(c));
    }
    onLog('audio-native-decoded', `frames=${buffer.length} sr=${buffer.sampleRate} ch=${buffer.numberOfChannels}`);
    return [{
      channelData,
      sampleRate: buffer.sampleRate,
      frameCount: buffer.length,
      timestampSeconds: sourceStart,
    }];
  } finally {
    try { audioCtx.close(); } catch {}
  }
}

/**
 * Stage 1 fix #2 — Render project audio as bounded PCM chunks instead of one
 * giant decoded source buffer. Only the used source ranges (sourceStart..sourceEnd
 * per clip) are demuxed and decoded. Each chunk is released by the caller after use.
 *
 * Returns { chunks, hasAudio, totalDurationSeconds, budget, trace }.
 */
export async function renderProjectAudioChunked(
  project: ProjectData,
  onLog: (step: string, detail: string) => void
): Promise<{
  chunks: DecodedPcm[];
  hasAudio: boolean;
  totalDurationSeconds: number;
  budget: ReturnType<typeof estimateAudioBudget>;
  trace: AudioPipelineTrace;
}> {
  const budget = estimateAudioBudget(project);
  onLog(
    'audio-budget',
    `needed=${budget.neededMB.toFixed(2)}MB limit=${budget.limitMB}MB within=${budget.withinBudget} clips=${budget.perClip.length}`
  );

  const chunks: DecodedPcm[] = [];
  let hasAudio = false;
  let totalDuration = 0;
  const trace: AudioPipelineTrace = { steps: [], demuxedSamples: 0, decodedFrames: 0 };

  const config = {
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
  };

  for (const clip of project.clips) {
    if (clip.trackType !== 'audio' && clip.trackType !== 'video') continue;
    if (clip.muted || clip.frozen) continue;
    if (!clip.mediaUrl) continue;

    const usedSeconds = Math.max(0, clip.duration);
    const sourceStart = clip.sourceStart ?? 0;
    const sourceEnd = clip.sourceEnd ?? usedSeconds;
    if (sourceEnd <= sourceStart) {
      trace.steps.push(`clip ${clip.id}: empty source range [${sourceStart},${sourceEnd})`);
      onLog('audio-skip-range', `${clip.id}: empty source range [${sourceStart},${sourceEnd})`);
      continue;
    }

    onLog('audio-clip', `demuxing ${clip.id} sourceStart=${sourceStart} sourceEnd=${sourceEnd} used=${usedSeconds.toFixed(2)}s`);

    let samples: RawAudioSample[];
    let audioSpecificConfig: Uint8Array | undefined;
    let trackTimescale: number;
    try {
      const demuxed = await demuxAudioRange(clip.mediaUrl, sourceStart, sourceEnd, onLog);
      samples = demuxed.samples;
      audioSpecificConfig = demuxed.audioSpecificConfig;
      trackTimescale = demuxed.timescale;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      trace.skipReason = `${clip.id}: demux failed: ${reason}`;
      onLog('audio-demux-failed', `${clip.id}: ${reason}`);
      continue;
    }
    trace.demuxedSamples += samples.length;
    if (samples.length === 0) {
      trace.steps.push(`clip ${clip.id}: 0 samples in range [${sourceStart},${sourceEnd})`);
      onLog('audio-skip-samples', `${clip.id}: 0 samples in range [${sourceStart},${sourceEnd}) timescale=${trackTimescale}`);
      continue;
    }

    let decoded: DecodedPcm[];
    try {
      decoded = await decodeAudioSamples(samples, { ...config, description: audioSpecificConfig }, onLog);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      onLog('audio-decode-failed', `${clip.id}: WebCodecs failed: ${reason} — trying native extractor`);
      try {
        decoded = await decodeViaNativeExtractor(clip.mediaUrl, sourceStart, sourceEnd, onLog);
        onLog('audio-native-recovered', `${clip.id}: native extractor recovered audio`);
      } catch (nativeErr) {
        const nativeReason = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
        trace.skipReason = `${clip.id}: decode failed: ${reason}; native extractor failed: ${nativeReason}`;
        onLog('audio-decode-failed', `${clip.id}: WebCodecs failed: ${reason}; native extractor failed: ${nativeReason}`);
        continue;
      }
    }
    trace.decodedFrames += decoded.length;
    if (decoded.length === 0) {
      trace.steps.push(`clip ${clip.id}: AudioDecoder produced 0 frames — trying native extractor`);
      onLog('audio-decode-empty', `${clip.id}: AudioDecoder produced 0 PCM frames — trying native extractor`);
      try {
        decoded = await decodeViaNativeExtractor(clip.mediaUrl, sourceStart, sourceEnd, onLog);
        onLog('audio-native-recovered', `${clip.id}: native extractor recovered audio`);
      } catch (nativeErr) {
        const nativeReason = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
        trace.skipReason = `${clip.id}: AudioDecoder produced 0 frames; native extractor failed: ${nativeReason}`;
        onLog('audio-decode-failed', `${clip.id}: 0 WebCodecs frames; native extractor failed: ${nativeReason}`);
        continue;
      }
    }

    hasAudio = true;
    totalDuration += clip.duration;

    for (const pcm of decoded) {
      const transformed = applyClipTransform(pcm, clip, clip.sourceStart, clip.sourceEnd);
      chunks.push(transformed);
    }
  }

  onLog('audio-render', `chunks=${chunks.length} hasAudio=${hasAudio} duration=${totalDuration.toFixed(2)}s demuxed=${trace.demuxedSamples} decoded=${trace.decodedFrames}`);
  return { chunks, hasAudio, totalDurationSeconds: totalDuration, budget, trace };
}
