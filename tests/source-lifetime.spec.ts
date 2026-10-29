import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function verifyExport(page: Page, id: string, label: string, info: TestInfo) {
  const output = await page.evaluate(async (id) => {
    const storagePath = '/src/utils/projectStorage.ts', exportPath = '/src/export/exportProject.ts';
    const { loadAllProjectsFromStorage, loadMediaBlobFromIdb } = await import(storagePath);
    const { exportProject } = await import(exportPath);
    const project = (await loadAllProjectsFromStorage()).find((p: { id: string }) => p.id === id);
    const result = await exportProject(project, 'mp4', { current: false }, () => {});
    const base64: string = await new Promise(resolve => {
      const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(result.blob);
    });
    const sources = await Promise.all(project.clips.filter((c: { mediaBlobId?: string }) => c.mediaBlobId).map(async (c: { mediaBlobId: string }) => {
      const blob = await loadMediaBlobFromIdb(c.mediaBlobId);
      return blob?.size || 0;
    }));
    return { base64, mime: result.blob.type, verification: result.verification, sources };
  }, id);
  expect(output.verification.ok).toBe(true);
  expect(output.sources.every((size: number) => size > 0)).toBe(true);
  mkdirSync('test-exports', { recursive: true });
  const file = resolve('test-exports/' + label + (output.mime.includes('mp4') ? '.mp4' : '.webm'));
  writeFileSync(file, Buffer.from(output.base64, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_packets', '-of', 'json', file], { encoding: 'utf8' }));
  expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  expect(Number(video.nb_read_frames)).toBeGreaterThan(35);
  const packets = probe.packets.filter((p: { pts_time?: string }) => Number.isFinite(Number(p.pts_time)));
  const duration = Math.max(...packets.map((p: { pts_time: string; duration_time?: string }) => Number(p.pts_time) + (Number(p.duration_time) || 0))) -
    Math.min(...packets.map((p: { pts_time: string }) => Number(p.pts_time)));
  expect(duration).toBeGreaterThan(1.7); expect(duration).toBeLessThan(2.5);
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'fps=5,scale=32:32', '-f', 'framemd5', '-'], { encoding: 'utf8' });
  expect(new Set(hashes.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop())).size).toBeGreaterThan(2);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
  let energy = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  expect(energy / (pcm.length / 2)).toBeGreaterThan(10);
  await info.attach(label + '-ffprobe', { body: JSON.stringify(probe), contentType: 'application/json' });
}

for (const decorated of [false, true]) {
  test('durable source: export three times, reopen from Home, split and export; effects=' + decorated, async ({ page }, info) => {
    test.setTimeout(180000);
    await page.addInitScript(() => localStorage.setItem('clipnova_onboarding_done_v3', 'true'));
    await page.goto('/');
    const id = await page.evaluate(async (decorated) => {
      const importPath = '/src/utils/mediaImporter.ts', storagePath = '/src/utils/projectStorage.ts', presetsPath = '/src/data/presets.ts';
      const { inspectAndImportMediaFile } = await import(importPath);
      const { saveProjectToStorage } = await import(storagePath);
      const { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
      const blob = await (await fetch('/test-assets/test-12s.webm')).blob();
      const media = await inspectAndImportMediaFile(new File([blob], 'repeat-source.webm', { type: 'video/webm' }), { onStepToast: () => {} });
      const clip = createBaseClip({ id: 'source', title: media.name, trackId: 'main', trackType: 'video', startTime: 0, duration: 2,
        sourceType: 'uploaded-video', mediaUrl: media.mediaUrl, mediaBlobId: media.mediaBlobId, transitionIn: decorated ? 'slide' : 'none' });
      const project = { ...INITIAL_PROJECT, id: 'repeat-' + decorated, name: 'Repeat ' + decorated, resolution: '480p', importedMedia: [media],
        clips: [clip, ...(decorated ? [createBaseClip({ id: 'light', title: 'Light Leak', trackId: 'effects', trackType: 'effect-layer',
          sourceType: 'effect-layer', effect: 'light-leak', startTime: 0, duration: 2 })] : [])] };
      await saveProjectToStorage(project);
      return project.id;
    }, decorated);
    for (let n = 1; n <= 3; n++) await verifyExport(page, id, id + '-export-' + n, info);
    await page.reload();
    await page.getByText('Repeat ' + decorated, { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();
    await verifyExport(page, id, id + '-reopened', info);
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await page.getByRole('button', { name: 'Split', exact: true }).first().click();
    await expect.poll(async () => page.evaluate(async (id) => {
      const path = '/src/utils/projectStorage.ts'; const { loadAllProjectsFromStorage } = await import(path);
      return (await loadAllProjectsFromStorage()).find((p: { id: string }) => p.id === id)?.clips.filter((c: { trackType: string }) => c.trackType === 'video').length;
    }, id)).toBe(2);
    await verifyExport(page, id, id + '-split', info);
  });
}

test('export resolves persisted bytes when the old import URL is no longer fetchable', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const importPath = '/src/utils/mediaImporter.ts', storagePath = '/src/utils/projectStorage.ts', presetsPath = '/src/data/presets.ts';
    const { inspectAndImportMediaFile } = await import(importPath);
    const { saveProjectToStorage } = await import(storagePath);
    const { INITIAL_PROJECT, createBaseClip } = await import(presetsPath);
    const blob = await (await fetch('/test-assets/test-12s.webm')).blob();
    const media = await inspectAndImportMediaFile(new File([blob], 'stale.webm', { type: 'video/webm' }), { onStepToast: () => {} });
    const project = { ...INITIAL_PROJECT, id: 'stale', name: 'Stale', resolution: '480p', importedMedia: [media],
      clips: [createBaseClip({ id: 'stale', title: media.name, trackId: 'main', trackType: 'video', startTime: 0, duration: 2,
        sourceType: 'uploaded-video', mediaUrl: media.mediaUrl, mediaBlobId: media.mediaBlobId })] };
    await saveProjectToStorage(project);
    // Simulate a browser-invalidated handle; this is not a claim that export itself revoked it.
    URL.revokeObjectURL(media.mediaUrl);
    return project.id;
  });
  await verifyExport(page, id, 'stale-handle', info);
});
