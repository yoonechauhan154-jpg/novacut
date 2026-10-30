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

for (const failure of ['mismatch', 'null', 'exception']) test('save rejects ' + failure + ' without reporting success', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (failure) => {
    const p = '/src/utils/androidBridge.ts'; const { saveToMediaStore } = await import(p);
    const filesystem = { writeFile: async () => ({}), appendFile: async () => ({}), getUri: async () => ({ uri: 'file:///cache/clipnova-exports/mock' }), deleteFile: async () => ({}) };
    const mediaSaver = {
      saveVideo: async () => { if (failure === 'exception') throw new Error('ENOSPC'); return { uri: failure === 'null' ? null : 'content://saved/1', size: 3, sdkInt: 35 }; },
      verifySize: async () => ({ verified: false, actualSize: 2, exists: true, pending: 0 }),
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
