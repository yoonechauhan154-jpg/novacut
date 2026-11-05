import { describe, it, expect } from 'vitest';
import { estimateAudioBudget, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS } from './audioBudget';
import { createBaseClip } from '../data/presets';
import type { ProjectData, TimelineClip } from '../types/editor';

const SAMPLE_RATE = AUDIO_SAMPLE_RATE;
const CHANNELS = AUDIO_CHANNELS;
const BYTES_PER_SAMPLE = 4;

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createBaseClip({
    id: 'clip-1',
    title: 'Test Clip',
    trackId: 'main-video',
    trackType: 'video',
    sourceType: 'uploaded-video',
    mediaUrl: 'file:///test.mp4',
    startTime: 0,
    duration: 10,
    sourceStart: 0,
    sourceEnd: 60,
    speed: 1,
    keepPitch: true,
    speedCurve: 'normal',
    reversed: false,
    frozen: false,
    muted: false,
    volume: 100,
    fadeIn: 0,
    fadeOut: 0,
    effect: 'none',
    effectIntensity: 0,
    transitionIn: 'none',
    keyframes: [],
    ...overrides,
  });
}

function makeProject(clips: TimelineClip[]): ProjectData {
  return {
    id: 'proj-1',
    name: 'Test',
    aspectRatio: '9:16',
    resolution: '1080p',
    fps: 30,
    background: { type: 'solid', solidColor: '#000000' },
    clips,
  } as ProjectData;
}

function expectedBytes(seconds: number): number {
  return seconds * SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
}

describe('estimateAudioBudget (used ranges, not file size)', () => {
  it('computes PCM bytes from used seconds only', () => {
    const project = makeProject([makeClip({ duration: 10 })]);
    const budget = estimateAudioBudget(project);

    expect(budget.neededBytes).toBe(expectedBytes(10));
    expect(budget.neededMB).toBeCloseTo(expectedBytes(10) / (1024 * 1024), 2);
    expect(budget.withinBudget).toBe(true);
  });

  it('ignores the full source file size — a 10s clip from a 50MB source needs ~3.8MB', () => {
    const project = makeProject([
      makeClip({ duration: 10, sourceStart: 0, sourceEnd: 60 }),
    ]);
    const budget = estimateAudioBudget(project);

    // 10 seconds * 48000 Hz * 2 ch * 4 bytes = 3,840,000 bytes ≈ 3.66 MB
    expect(budget.neededMB).toBeLessThan(5);
    expect(budget.neededBytes).toBe(expectedBytes(10));
    // Not even close to 50 MB
    expect(budget.neededMB).toBeLessThan(50);
  });

  it('sums across multiple clips', () => {
    const project = makeProject([
      makeClip({ id: 'c1', duration: 5 }),
      makeClip({ id: 'c2', startTime: 5, duration: 7 }),
    ]);
    const budget = estimateAudioBudget(project);

    expect(budget.neededBytes).toBe(expectedBytes(12));
    expect(budget.perClip).toHaveLength(2);
  });

  it('skips muted and frozen clips', () => {
    const project = makeProject([
      makeClip({ id: 'c1', duration: 10, muted: true }),
      makeClip({ id: 'c2', duration: 10, frozen: true }),
      makeClip({ id: 'c3', duration: 10 }),
    ]);
    const budget = estimateAudioBudget(project);

    expect(budget.neededBytes).toBe(expectedBytes(10));
    expect(budget.perClip).toHaveLength(1);
    expect(budget.perClip[0].clipId).toBe('c3');
  });

  it('skips clips without mediaUrl', () => {
    const project = makeProject([
      makeClip({ id: 'c1', duration: 10, mediaUrl: undefined }),
      makeClip({ id: 'c2', duration: 10 }),
    ]);
    const budget = estimateAudioBudget(project);

    expect(budget.neededBytes).toBe(expectedBytes(10));
    expect(budget.perClip).toHaveLength(1);
  });

  it('reports withinBudget=false when needed exceeds limit', () => {
    const project = makeProject([makeClip({ duration: 200 })]); // 200s * 48k * 2ch * 4B = ~76MB > 96MB? no, 76MB < 96MB
    const budget = estimateAudioBudget(project, 1); // 1 MB limit

    expect(budget.withinBudget).toBe(false);
    expect(budget.limitMB).toBe(1);
  });

  it('reports withinBudget=true when within limit', () => {
    const project = makeProject([makeClip({ duration: 10 })]);
    const budget = estimateAudioBudget(project, 100);

    expect(budget.withinBudget).toBe(true);
    expect(budget.limitMB).toBe(100);
  });

  it('perClip includes source range info', () => {
    const project = makeProject([
      makeClip({ id: 'c1', duration: 5, sourceStart: 30, sourceEnd: 35 }),
    ]);
    const budget = estimateAudioBudget(project);

    expect(budget.perClip[0].sourceStart).toBe(30);
    expect(budget.perClip[0].sourceEnd).toBe(35);
    expect(budget.perClip[0].usedSeconds).toBe(5);
  });

  it('handles empty project gracefully', () => {
    const project = makeProject([]);
    const budget = estimateAudioBudget(project);

    expect(budget.neededBytes).toBe(0);
    expect(budget.neededMB).toBe(0);
    expect(budget.withinBudget).toBe(true);
    expect(budget.perClip).toHaveLength(0);
  });
});
