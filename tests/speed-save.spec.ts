import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

test.beforeAll(() => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=10:size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*(330*t+22*t*t)):s=48000:d=10',
    '-vf', "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{n}':x=10:y=10:fontsize=30:fontcolor=white:box=1:boxcolor=black",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'test-assets/speed-counter.mp4']);
});

async function openSource(page: Page, duration = 10) {
  await page.addInitScript(() => localStorage.setItem('clipnova_onboarding_done_v3', 'true'));
  await page.goto('/');
  await page.evaluate(async (duration) => {
    const ip = '/src/utils/mediaImporter.ts', pp = '/src/data/presets.ts';
    const { inspectAndImportMediaFile } = await import(ip), { INITIAL_PROJECT, createBaseClip } = await import(pp);
    const blob = await (await fetch('/test-assets/speed-counter.mp4')).blob();
    const media = await inspectAndImportMediaFile(new File([blob], 'counter.mp4', { type: 'video/mp4' }), { onStepToast: () => {} });
    const project = { ...INITIAL_PROJECT, id: 'speed-save', name: 'Speed save', aspectRatio: '16:9', resolution: '480p', fps: 30,
      importedMedia: [media], clips: [createBaseClip({ id: 'counter', title: 'counter.mp4', trackId: 'main', trackType: 'video',
        sourceType: 'uploaded-video', mediaUrl: media.mediaUrl, mediaBlobId: media.mediaBlobId,
        sourceStart: 0, sourceEnd: duration, startTime: 0, duration })] };
    await (window as any).__clipnovaSourceTest.open(project);
  }, duration);
  await expect.poll(() => page.evaluate(() => (window as any).__clipnovaSourceTest?.project.id)).toBe('speed-save');
}
async function speed(page: Page, value: number) {
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await page.getByRole('slider', { name: 'Playback Speed', exact: true }).fill(String(value));
  await expect.poll(() => page.evaluate(() => (window as any).__clipnovaSourceTest.project.clips[0].speed)).toBe(value);
}
async function output(page: Page, name: string) {
  const b64 = await page.evaluate(async () => {
    const r = await (window as any).__clipnovaSourceTest.export();
    if (!r?.blob) throw new Error('Export failed: ' + document.body.innerText);
    return await new Promise<string>(resolve => { const f = new FileReader(); f.onload = () => resolve(String(f.result).split(',')[1]); f.readAsDataURL(r.blob); });
  });
  mkdirSync('test-exports', { recursive: true });
  const file = 'test-exports/' + name + '.webm'; writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

for (const rate of [0.5, 2]) test('speed ' + rate + ' exports complete counter and matching audio duration', async ({ page }, info) => {
  test.setTimeout(150000);
  await openSource(page); await speed(page, rate);
  const file = await output(page, 'speed-' + rate);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_packets', '-of', 'json', file], { encoding: 'utf8' }));
  const span = (type: string) => {
    const stream = probe.streams.find((s: any) => s.codec_type === type); expect(stream).toBeTruthy();
    const p = probe.packets.filter((p: any) => p.stream_index === stream.index);
    return Math.max(...p.map((p: any) => Number(p.pts_time) + (Number(p.duration_time) || 0))) - Math.min(...p.map((p: any) => Number(p.pts_time)));
  };
  expect(span('video')).toBeCloseTo(10 / rate, 0);
  expect(Math.abs(span('audio') - span('video'))).toBeLessThan(.3);
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'fps=10,scale=64:36', '-f', 'framemd5', '-'], { encoding: 'utf8' })
    .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop());
  expect(new Set(hashes).size).toBeGreaterThan(hashes.length * .85);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ar', '8000', '-ac', '1', '-f', 's16le', '-']);
  let energy = 0; for (let i = 0; i + 1 < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  expect(energy / (pcm.length / 2)).toBeGreaterThan(100);
  await info.attach('ffprobe-speed-' + rate, { body: JSON.stringify(probe), contentType: 'application/json' });
});

test('speed UI resizes timeline and participates in undo redo', async ({ page }) => {
  await openSource(page); await speed(page, 2);
  const clip = () => page.evaluate(() => (window as any).__clipnovaSourceTest.project.clips[0]);
  expect((await clip()).duration).toBe(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await clip()).speed).toBe(1); expect((await clip()).duration).toBe(10);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await clip()).speed).toBe(2); expect((await clip()).duration).toBe(5);
});

for (const failure of ['mismatch', 'null', 'exception', 'pending']) test('save rejects ' + failure + ' without reporting success', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (failure) => {
    const p = '/src/utils/androidBridge.ts'; const { saveToMediaStore } = await import(p);
    const filesystem = { writeFile: async () => ({}), appendFile: async () => ({}), getUri: async () => ({ uri: 'file:///cache/clipnova-exports/mock' }), deleteFile: async () => ({}) };
    const mediaSaver = {
      saveVideo: async () => { if (failure === 'exception') throw new Error('ENOSPC'); return { uri: failure === 'null' ? null : 'content://saved/1', size: 3, sdkInt: 35 }; },
      verifySize: async () => ({ verified: failure === 'pending', actualSize: failure === 'pending' ? 3 : 2, exists: true, pending: failure === 'pending' ? 1 : 0 }),
    };
    return await saveToMediaStore(new Blob(['abc']), 'same.mp4', 'video/mp4', { native: true, filesystem, mediaSaver });
  }, failure);
  expect(result.saved).toBe(false); expect(result.error).toBeTruthy();
});

test('five Gallery copies use unique names and large output copies every byte', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = '/src/utils/androidBridge.ts'; const { saveToMediaStore } = await import(p);
    const names: string[] = []; let count = 0, writes = 0;
    const filesystem = { writeFile: async ({ data }: any) => { count = atob(data).length; writes++; }, appendFile: async ({ data }: any) => { count += atob(data).length; writes++; },
      getUri: async () => ({ uri: 'file:///cache/clipnova-exports/mock' }), deleteFile: async () => ({}) };
    const mediaSaver = {
      saveVideo: async ({ displayName, expectedSize }: any) => { names.push(displayName); if (count !== expectedSize) throw new Error('bytes missing'); return { uri: 'content://saved/' + names.length, size: count, sdkInt: 35 }; },
      verifySize: async ({ expectedSize }: any) => ({ verified: true, actualSize: expectedSize, exists: true, pending: 0 }),
    };
    const blob = new Blob([new Uint8Array(9 * 1024 * 1024 + 17)], { type: 'video/mp4' });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await saveToMediaStore(blob, 'same.mp4', blob.type, { native: true, filesystem, mediaSaver }));
    return { names, writes, saved: results.every(r => r.saved) };
  });
  expect(new Set(result.names).size).toBe(5); expect(result.saved).toBe(true); expect(result.writes).toBeGreaterThan(5);
});

for (const rate of [.5, 2]) test('preview clock and decoder use speed ' + rate, async ({ page }) => {
  await openSource(page); await speed(page, rate);
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForTimeout(1200);
  const debug = await page.evaluate(() => (window as any).__debug);
  expect(debug.isPlaying).toBe(true);
  expect(debug.activeSourceTime).toBeCloseTo(debug.playheadTime * rate, 1);
  const playing = debug.elements.filter((e: any) => !e.paused);
  expect(playing.length).toBeGreaterThan(0);
  for (const el of playing) {
    expect(el.playbackRate).toBe(rate); expect(el.preservesPitch).toBe(true);
    expect(Math.abs(el.currentTime - debug.activeSourceTime)).toBeLessThan(.35);
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await page.getByRole('button', { name: 'Split', exact: true }).first().click();
  const clips = await page.evaluate(() => (window as any).__clipnovaSourceTest.project.clips);
  expect(clips).toHaveLength(2);
  expect(clips[0].speed).toBe(rate); expect(clips[1].speed).toBe(rate);
  expect(clips[0].sourceEnd).toBeCloseTo(clips[1].sourceStart, 6);
  expect(clips[0].duration + clips[1].duration).toBeCloseTo(10 / rate, 6);
  expect(clips[1].sourceEnd).toBeCloseTo(10, 6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__clipnovaSourceTest.project.clips.length)).toBe(1);
});

test('reverse speed mapping, split ranges, and ripple preserve source span', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = '/src/utils/clipTiming.ts', base = '/src/data/presets.ts';
    const { changeClipSpeed, clipSourceTime, splitClip } = await import(p), { createBaseClip, INITIAL_PROJECT } = await import(base);
    const clip = createBaseClip({ id: 'r', title: 'r', trackId: 'main', trackType: 'video', sourceType: 'uploaded-video',
      sourceStart: 3, sourceEnd: 13, startTime: 2, duration: 10, reversed: true });
    const after = { ...clip, id: 'later', startTime: 12, reversed: false };
    const layer = { ...after, id: 'layer', trackId: 'fx', trackType: 'effect-layer' };
    const project = changeClipSpeed({ ...INITIAL_PROJECT, clips: [clip, after, layer] }, 'r', 2);
    const c = project.clips[0], halves = splitClip(c, 2, 'right');
    return { duration: c.duration, times: [clipSourceTime(c, 2), clipSourceTime(c, 4), clipSourceTime(c, 7)],
      starts: project.clips.slice(1).map((c: any) => c.startTime), halves };
  });
  expect(result.duration).toBe(5); expect(result.starts).toEqual([7, 7]);
  expect(result.times[0]).toBeCloseTo(13, 2); expect(result.times[1]).toBe(9); expect(result.times[2]).toBe(3);
  expect(result.halves.map((c: any) => [c.sourceStart, c.sourceEnd, c.speed])).toEqual([[9, 13, 2], [3, 9, 2]]);
});

async function mockGallery(page: Page, failure = '') {
  await page.evaluate((failure) => {
    const files = new Map<string, number>(); const names: string[] = [];
    (window as any).__saveMock = { files, names, failure, saveAsCalls: 0 };
    const filesystem = {
      writeFile: async ({ path, data }: any) => { files.set(path, atob(data).length); },
      appendFile: async ({ path, data }: any) => { files.set(path, (files.get(path) || 0) + atob(data).length); },
      stat: async ({ path }: any) => ({ size: files.get(path.replace('/mock/files/', '')) || 0 }),
      getUri: async ({ path }: any) => ({ uri: 'file:///mock/files/' + path }),
      deleteFile: async ({ path }: any) => { files.delete(path); },
    };
    const mediaSaver = {
      saveVideo: async ({ displayName, expectedSize, path }: any) => {
        const state = (window as any).__saveMock;
        if (files.get(path.replace('/mock/files/', '')) !== expectedSize) throw new Error('Wrong retained input');
        names.push(displayName);
        if (state.failure === 'exception') throw new Error('ENOSPC: simulated full Gallery');
        return { uri: state.failure === 'null' ? null : 'content://media/' + names.length, size: expectedSize,
          relativePath: 'Movies/ClipNova/' + displayName, method: 'mediastore', sdkInt: 35 };
      },
      verifySize: async ({ expectedSize }: any) => ({ verified: (window as any).__saveMock.failure !== 'mismatch',
        actualSize: (window as any).__saveMock.failure === 'mismatch' ? 1 : expectedSize, exists: true, pending: 0 }),
      saveAs: async ({ expectedSize }: any) => { (window as any).__saveMock.saveAsCalls++; (window as any).__saveMock.failure = '';
        return { uri: 'content://documents/chosen', size: expectedSize, method: 'document', sdkInt: 35 }; },
      openUri: async () => ({}), shareUri: async () => ({}),
    };
    (window as any).__clipnovaSaveDependencies = { native: true, filesystem, mediaSaver };
  }, failure);
}
test('automatic save publishes five decorated exports with five entries and retained files', async ({ page }) => {
  test.setTimeout(120000);
  await openSource(page, 1.2); await mockGallery(page);
  await page.evaluate(async () => {
    const p = '/src/data/presets.ts', { createBaseClip } = await import(p), app = (window as any).__clipnovaSourceTest;
    await app.open({ ...app.project, clips: [{ ...app.project.clips[0], transitionIn: 'slide' },
      createBaseClip({ id: 'fx', title: 'Light Leak', trackId: 'fx', trackType: 'effect-layer', sourceType: 'effect-layer',
        startTime: 0, duration: 1.2, effect: 'light-leak' })] });
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async () => { const result = await (window as any).__clipnovaSourceTest.export(); if (!result) throw new Error('Render failed'); });
    await expect(page.getByTestId('save-status')).toContainText('Saved to Movies/ClipNova/');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  const state = await page.evaluate(() => ({ entries: JSON.parse(localStorage.getItem('clipnova_my_exports') || '[]'),
    names: (window as any).__saveMock.names, retained: (window as any).__saveMock.files.size }));
  expect(state.entries).toHaveLength(5); expect(state.entries.every((e: any) => e.status === 'saved' && e.uri.startsWith('content://') && e.retainedUri)).toBe(true);
  expect(new Set(state.names).size).toBe(5); expect(state.retained).toBe(5);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('clipnova_my_exports') || '[]').length)).toBe(5);
});

for (const failure of ['null', 'exception', 'mismatch']) test('automatic save ' + failure + ' exposes Save as and retains finished bytes', async ({ page }) => {
  await openSource(page, 1.2); await mockGallery(page, failure);
  await page.evaluate(async () => { await (window as any).__clipnovaSourceTest.export(); });
  await expect(page.getByTestId('save-status')).toContainText('Save failed');
  const failed = await page.evaluate(() => JSON.parse(localStorage.getItem('clipnova_my_exports') || '[]')[0]);
  expect(failed.status).toBe('failed'); expect(failed.retainedUri).toContain('clipnova-outputs/');
  expect(failed.diagnostics).toContain('exception');
  await page.getByRole('button', { name: 'Save as…', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('content://documents/chosen');
  const after = await page.evaluate(() => ({ entries: JSON.parse(localStorage.getItem('clipnova_my_exports') || '[]'), files: (window as any).__saveMock.files.size }));
  expect(after.entries).toHaveLength(1); expect(after.entries[0].status).toBe('saved'); expect(after.files).toBe(1);
});

test('keep pitch worker preserves a tone and reverse audio follows source order', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = '/src/export/audioStretch.ts', b = '/src/data/presets.ts';
    const { stretchClipAudio } = await import(p), { createBaseClip } = await import(b);
    const context = new OfflineAudioContext(1, 48000, 48000), source = context.createBuffer(1, 48000, 48000);
    const data = source.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = .4 * Math.sin(2 * Math.PI * 440 * i / 48000);
    const values = [];
    for (const rate of [.5, 2]) for (const keepPitch of [true, false]) {
      const clip = createBaseClip({ id: 'tone', trackId: 'audio', trackType: 'audio', title: 'tone', sourceType: 'uploaded-audio',
        startTime: 0, duration: 1 / rate, sourceStart: 0, sourceEnd: 1, speed: rate, keepPitch });
      const out = await stretchClipAudio(source, clip, context), channel = out.getChannelData(0);
      let crossings = 0; const start = Math.floor(channel.length * .2), end = Math.floor(channel.length * .8);
      for (let i = start + 1; i < end; i++) if (channel[i - 1] <= 0 && channel[i] > 0) crossings++;
      values.push({ rate, keepPitch, duration: out.duration, hz: crossings / ((end - start) / 48000) });
    }
    const ramp = context.createBuffer(1, 48000, 48000);
    for (let i = 0; i < 48000; i++) ramp.getChannelData(0)[i] = i / 48000;
    const reversed = await stretchClipAudio(ramp, createBaseClip({ id: 'reverse', title: 'r', trackId: 'a', trackType: 'audio', sourceType: 'uploaded-audio',
      startTime: 0, duration: .5, speed: 2, reversed: true, keepPitch: false }), context);
    return { values, reverse: [reversed.getChannelData(0)[0], reversed.getChannelData(0)[23999]] };
  });
  for (const value of result.values) {
    expect(value.duration).toBeCloseTo(1 / value.rate, 4);
    expect(Math.abs(value.hz - 440 * (value.keepPitch ? 1 : value.rate))).toBeLessThan(20);
  }
  expect(result.reverse[0]).toBeGreaterThan(.99); expect(result.reverse[1]).toBeLessThan(.001);
});

test('legacy speed projects and overlapping effect layers adopt source duration', async ({ page }) => {
  await page.goto('/');
  const clips = await page.evaluate(async () => {
    const p = '/src/utils/clipTiming.ts', b = '/src/data/presets.ts';
    const { normalizeClipSpeeds } = await import(p), { INITIAL_PROJECT, createBaseClip } = await import(b);
    return normalizeClipSpeeds({ ...INITIAL_PROJECT, clips: [
      createBaseClip({ id: 'v', title: 'v', trackId: 'main', trackType: 'video', sourceType: 'uploaded-video',
        startTime: 0, duration: 10, sourceStart: 0, sourceEnd: 10, speed: 2 }),
      createBaseClip({ id: 'fx', title: 'fx', trackId: 'fx', trackType: 'effect-layer', sourceType: 'effect-layer',
        startTime: 0, duration: 10, effect: 'light-leak' }),
    ] }).clips;
  });
  expect(clips.map((c: any) => c.duration)).toEqual([5, 5]);
  expect(clips[0].sourceEnd).toBe(10);
});

test('full app storage keeps finished Blob and can stream Save as without a cache copy', async ({ page }) => {
  await openSource(page, 1.2); await mockGallery(page);
  await page.evaluate(() => {
    const deps = (window as any).__clipnovaSaveDependencies;
    deps.filesystem.writeFile = async () => { throw new Error('ENOSPC app storage'); };
    let bytes = 0, expected = 0;
    deps.mediaSaver.beginDocument = async (options: any) => { expected = options.expectedSize; return { id: 'stream', uri: 'content://documents/direct', sdkInt: 35 }; };
    deps.mediaSaver.writeDocumentChunk = async ({ data }: any) => { bytes += atob(data).length; return { written: bytes }; };
    deps.mediaSaver.finishDocument = async () => { if (bytes !== expected) throw new Error('Missing bytes');
      return { uri: 'content://documents/direct', size: bytes, method: 'document', sdkInt: 35 }; };
    deps.mediaSaver.abortDocument = async () => {};
  });
  await page.evaluate(async () => { await (window as any).__clipnovaSourceTest.export(); });
  await expect(page.getByTestId('save-status')).toContainText('keep this app open');
  await page.evaluate(async () => { await (window as any).__clipnovaSourceTest.export(); });
  await expect(page.getByTestId('save-status')).toContainText('previous finished output');
  await page.getByRole('button', { name: 'Save as…', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('content://documents/direct');
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('clipnova_my_exports') || '[]'));
  expect(entries).toHaveLength(1); expect(entries[0].status).toBe('saved'); expect(entries[0].diagnostics).toContain('document-stream');
});

test('WebCodecs high speed advances through decoded source frames', async ({ page }, info) => {
  test.setTimeout(90000); await openSource(page);
  const result = await page.evaluate(async () => {
    const p = '/src/export/webCodecsExport.ts', timing = '/src/utils/clipTiming.ts';
    const { encodeWebCodecs } = await import(p), { changeClipSpeed } = await import(timing);
    const project = changeClipSpeed((window as any).__clipnovaSourceTest.project, 'counter', 10);
    let result: any;
    await encodeWebCodecs({ project, format: 'mp4', cancelRef: { current: false }, safeMode: true,
      onProgress: () => {}, onResult: (r: any) => { result = r; }, onError: (e: any) => { throw new Error(e); } }, () => {});
    const base64 = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(result.blob); });
    return { base64, frames: result.frames };
  });
  const file = 'test-exports/speed-10-webcodecs.mp4'; writeFileSync(file, Buffer.from(result.base64, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  expect(Number(probe.streams[0].duration)).toBeCloseTo(1, 1); expect(Number(probe.streams[0].nb_read_frames)).toBe(30);
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'scale=64:36', '-f', 'framemd5', '-'], { encoding: 'utf8' })
    .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop());
  expect(new Set(hashes).size).toBeGreaterThan(27);
  await info.attach('ffprobe-10x', { body: JSON.stringify(probe), contentType: 'application/json' });
});
