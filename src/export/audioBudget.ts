import type { ProjectData } from '../types/editor';

export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BYTES_PER_SAMPLE = 4; // Float32 PCM per sample per channel

export interface AudioBudgetPerClip {
  clipId: string;
  trackType: string;
  sourceStart: number;
  sourceEnd: number;
  usedSeconds: number;
  neededBytes: number;
}

export interface AudioBudget {
  neededBytes: number;
  neededMB: number;
  limitBytes: number;
  limitMB: number;
  withinBudget: boolean;
  perClip: AudioBudgetPerClip[];
}

const DEFAULT_LIMIT_MB = 96;

/**
 * Estimate the PCM audio memory needed from the USED ranges only.
 *
 * usedSeconds = clip.duration (timeline seconds actually rendered), NOT the
 * full source file duration. A 10-second clip cut from a 50 MB file needs
 * ~3.8 MB of PCM, not 50 MB.
 *
 * neededBytes = sum over clips of (usedSeconds * sampleRate * channels * 4)
 */
export function estimateAudioBudget(
  project: ProjectData,
  limitMB = DEFAULT_LIMIT_MB
): AudioBudget {
  let totalBytes = 0;
  const perClip: AudioBudgetPerClip[] = [];

  for (const clip of project.clips) {
    if (clip.trackType !== 'audio' && clip.trackType !== 'video') continue;
    if (clip.muted || clip.frozen) continue;
    if (!clip.mediaUrl) continue;

    const usedSeconds = Math.max(0, clip.duration);
    const neededBytes =
      usedSeconds * AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE;
    totalBytes += neededBytes;
    perClip.push({
      clipId: clip.id,
      trackType: clip.trackType,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      usedSeconds,
      neededBytes,
    });
  }

  const neededMB = totalBytes / (1024 * 1024);
  const limitBytes = limitMB * 1024 * 1024;

  return {
    neededBytes: totalBytes,
    neededMB,
    limitBytes,
    limitMB,
    withinBudget: totalBytes <= limitBytes,
    perClip,
  };
}
