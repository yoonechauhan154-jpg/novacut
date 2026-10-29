import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('export seeks attach listeners before currentTime and report a timed-out decoder', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/export/exportMedia.ts';
    const { attachExportVideo, seekVideo } = await import(path);
    const video = attachExportVideo('test-sync-seek');
    let time = 0;
    Object.defineProperty(video, 'readyState', { get: () => 2 });
    Object.defineProperty(video, 'currentTime', {
      configurable: true, get: () => time,
      set: value => { time = value; video.dispatchEvent(new Event('seeked')); },
    });
    const log: string[] = [];
    await seekVideo(video, 1, { current: false }, (_step: string, message: string) => log.push(message), 100);
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1, set: () => {} });
    let failed = false;
    try { await seekVideo(video, 2, { current: false }, (_step: string, message: string) => log.push(message), 100); }
    catch { failed = true; }
    video.remove();
    return { time, failed, diagnostic: JSON.parse(log[0]) };
  });
  expect(result.time).toBe(1);
  expect(result.failed).toBe(true);
  expect(result.diagnostic).toMatchObject({ element: 'test-sync-seek', attached: true, readyState: 2, target: 2 });
  for (const key of ['srcType', 'networkState', 'error', 'seekable', 'buffered']) expect(result.diagnostic).toHaveProperty(key);
});

test('split clips have independent export decoders and dispose after cancellation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/export/exportMedia.ts', presetsPath = '/src/data/presets.ts';
    const { createExportMedia, seekVideo } = await import(modulePath);
    const { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
    const clip = createBaseClip({ id: 'left', trackId: 'main', trackType: 'video', title: 'source',
      startTime: 0, duration: 2, sourceType: 'uploaded-video', mediaUrl: '/test-assets/test-12s.webm' });
    const session = await createExportMedia({ ...INITIAL_PROJECT, clips: [clip, { ...clip, id: 'right', startTime: 2, sourceStart: 4 }] },
      { current: false }, () => {});
    const a = session.media.get('left'), b = session.media.get('right');
    await seekVideo(a, .5, { current: false }, () => {});
    await seekVideo(b, 4.5, { current: false }, () => {});
    const distinct = a !== b && a.isConnected && b.isConnected;
    const times = [a.currentTime, b.currentTime];
    let cancelled = false;
    try { await seekVideo(a, 1, { current: true }, () => {}); } catch { cancelled = true; }
    session.dispose();
    return { distinct, times, cancelled, remaining: document.querySelectorAll('[data-export-clip-id]').length };
  });
  expect(result.distinct).toBe(true);
  expect(result.times[0]).toBeCloseTo(.5, 1); expect(result.times[1]).toBeCloseTo(4.5, 1);
  expect(result.cancelled).toBe(true); expect(result.remaining).toBe(0);
});

test('Export Lab T1 and T2 run without a mounted editor canvas or preview cache', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const enginePath = '/src/export/exportEngine.ts', presetsPath = '/src/data/presets.ts';
    const { runExportLabTest } = await import(enginePath), { INITIAL_PROJECT } = await import(presetsPath);
    const before = document.querySelectorAll('canvas').length;
    const results = [];
    for (const type of ['T1', 'T2']) results.push(await runExportLabTest(type,
      { ...INITIAL_PROJECT, clips: [] }, document.createElement('canvas'), new Map(), new Map(), { current: false }));
    return { before, results, remaining: document.querySelectorAll('[data-export-clip-id]').length };
  });
  for (const r of result.results) expect(r.status, JSON.stringify(r)).toBe('ok');
  expect(result.remaining).toBe(0);
});

test('real split/join export has moving frames, timeline duration and audible audio', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/');
  const output = await page.evaluate(async () => {
    const exporterPath = '/src/export/exportProject.ts', presetsPath = '/src/data/presets.ts';
    const { exportProject } = await import(exporterPath), { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
    const left = createBaseClip({ id: 'a', trackId: 'main', trackType: 'video', title: 'source',
      startTime: 0, duration: 2, sourceType: 'uploaded-video', mediaUrl: '/test-assets/test-12s.webm' });
    const right = { ...left, id: 'b', startTime: 2, sourceStart: 4, sourceEnd: 8, speed: 2, duration: 2, volume: 50 };
    const result = await exportProject({ ...INITIAL_PROJECT, resolution: '480p', fps: 30, clips: [left, right] },
      'mp4', { current: false }, () => {});
    const base64: string = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(result.blob); });
    return { base64, mime: result.blob.type, verification: result.verification,
      remaining: document.querySelectorAll('[data-export-clip-id]').length };
  });
  expect(output.verification.ok).toBe(true);
  expect(output.verification.hasAudio).toBe(true);
  expect(output.verification.framesChanging).toBe(true);
  expect(output.remaining).toBe(0);
  mkdirSync('test-exports', { recursive: true });
  const file = resolve('test-exports/phase1-split-join.' + (output.mime.includes('mp4') ? 'mp4' : 'webm'));
  writeFileSync(file, Buffer.from(output.base64, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
  expect(video).toBeTruthy(); expect(audio).toBeTruthy();
  expect(Number(probe.format.duration)).toBeGreaterThan(3.6); expect(Number(probe.format.duration)).toBeLessThan(4.5);
  expect(Number(video.nb_read_frames)).toBeGreaterThan(30);
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'fps=2,scale=32:32', '-f', 'framemd5', '-'], { encoding: 'utf8' });
  expect(new Set(hashes.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop())).size).toBeGreaterThan(2);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
  let energy = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  expect(energy / (pcm.length / 2)).toBeGreaterThan(10);
  await testInfo.attach('ffprobe', { body: JSON.stringify(probe, null, 2), contentType: 'application/json' });
});

test('native compatibility rejects edits it cannot preserve', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const nativePath = '/src/export/nativeExport.ts', presetsPath = '/src/data/presets.ts';
    const { nativeUnsupported } = await import(nativePath), { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
    const clip = createBaseClip({ id: 'a', trackId: 'main', trackType: 'video', title: 'source',
      startTime: 0, duration: 2, sourceType: 'uploaded-video', mediaUrl: 'blob:test' });
    const project = { ...INITIAL_PROJECT, clips: [clip] };
    return {
      baseline: nativeUnsupported(project),
      effect: nativeUnsupported({ ...project, clips: [{ ...clip, effect: 'glitch' }] }),
      gap: nativeUnsupported({ ...project, clips: [{ ...clip, startTime: 1 }] }),
      pip: nativeUnsupported({ ...project, clips: [clip, { ...clip, id: 'pip', trackType: 'overlay' }] }),
    };
  });
  expect(result.baseline).toEqual([]);
  expect(result.effect.length).toBeGreaterThan(0); expect(result.gap.length).toBeGreaterThan(0); expect(result.pip.length).toBeGreaterThan(0);
});

test('WebCodecs MP4 has microsecond timestamps and decoder configuration', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/');
  const supported = await page.evaluate(async () => typeof VideoEncoder !== 'undefined' &&
    (await VideoEncoder.isConfigSupported({ codec: 'avc1.420028', width: 816, height: 460, framerate: 30, bitrate: 1000000 })).supported);
  test.skip(!supported, 'This headless Chromium has no H.264 VideoEncoder; the real browser recorder export is tested separately.');
  const output = await page.evaluate(async () => {
    const enginePath = '/src/export/webCodecsExport.ts', presetsPath = '/src/data/presets.ts', verifyPath = '/src/export/verifyOutput.ts';
    const { encodeWebCodecs } = await import(enginePath), { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
    const { inspectMp4 } = await import(verifyPath);
    const clip = createBaseClip({ id: 'synthetic', trackId: 'main', trackType: 'video', title: 'moving pattern',
      startTime: 0, duration: 1, sourceType: 'procedural-scene' });
    let blob: Blob | undefined;
    await encodeWebCodecs({ project: { ...INITIAL_PROJECT, aspectRatio: '16:9', resolution: '480p', fps: 30, clips: [clip] },
      canvas: document.createElement('canvas'), mediaElementCache: new Map(), audioElementsRef: new Map(),
      format: 'mp4', safeMode: true, cancelRef: { current: false }, onProgress: () => {}, onError: (e: string) => { throw new Error(e); },
      onResult: (r: { blob: Blob }) => { blob = r.blob; } }, () => {});
    return await inspectMp4(blob!);
  });
  expect(output.frames).toBe(30);
  expect(output.duration).toBeCloseTo(1, 1);
  expect(output.hasAudio).toBe(false);
  await testInfo.attach('mp4-sample-table', { body: JSON.stringify(output), contentType: 'application/json' });
});
