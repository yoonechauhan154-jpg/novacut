import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { MediaSaverPlugin } from '../src/utils/androidBridge';

const contract = JSON.parse(readFileSync('contracts/media-save-request.json', 'utf8')) as Parameters<MediaSaverPlugin['saveVideo']>[0];

test('Gallery bridge sends shared contract names and numeric size with decoded file path', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (contract) => {
    const path = '/src/utils/androidBridge.ts', { publishExportPath } = await import(path);
    const calls: any[] = [];
    const saver = {
      saveVideo: async (payload: any) => { calls.push(payload); return { uri: 'content://media/saved', size: payload.expectedSize, sdkInt: 36, method: 'mediastore' }; },
      verifySize: async (payload: any) => { calls.push(payload); return { exists: true, pending: 0, verified: true, actualSize: payload.expectedSize }; },
    };
    const saved = await publishExportPath('file://' + contract.path.replace(/ /g, '%20'), contract.displayName, contract.mimeType, contract.expectedSize, saver);
    return { calls, saved };
  }, contract);
  expect(result.calls[0]).toEqual(contract);
  expect(Object.keys(result.calls[0]).sort()).toEqual(Object.keys(contract).sort());
  expect(typeof result.calls[0].expectedSize).toBe('number');
  expect(result.calls[1]).toEqual({ uri: 'content://media/saved', expectedSize: contract.expectedSize });
  expect(result.saved.saved).toBe(true); expect(result.saved.sdkInt).toBe(36);
});

test('native error reports Android 16 API level at the top level', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/utils/androidBridge.ts', { publishExportPath } = await import(path);
    return publishExportPath('/files/clipnova-outputs/export.mp4', 'export.mp4', 'video/mp4', 7388734, {
      saveVideo: async () => { throw new Error('Save failed: {"method":"mediastore","apiLevel":36,"bytesWritten":0,"expectedSize":0,"exception":"java.io.IOException: Input size mismatch: 7388734/0"}'); },
      verifySize: async () => { throw new Error('Should not verify failed save'); },
    });
  });
  expect(result.saved).toBe(false); expect(result.sdkInt).toBe(36);
  expect(JSON.parse(result.diagnostics!).apiLevel).toBe(36);
});

for (const cancel of [false, true]) test('MediaStore insert failure automatically opens Save as, cancel=' + cancel, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (cancel) => {
    const path = '/src/utils/androidBridge.ts', { publishExportPath } = await import(path);
    const calls: any[] = []; const events: any[] = [];
    window.addEventListener('clipnova-save-fallback', (event: any) => events.push(event.detail));
    const saved = await publishExportPath('/files/clipnova-outputs/export.mp4', 'export.mp4', 'video/mp4', 7388734, {
      saveVideo: async () => { throw new Error('Save failed: {"code":"MEDIASTORE_INSERT_FAILED","apiLevel":36,"exception":"MediaStore insert returned null URI"}'); },
      saveAs: async (payload: any) => { calls.push(payload); if (cancel) throw new Error('Save as cancelled; finished output retained in My exports');
        return { uri: 'content://documents/chosen', size: payload.expectedSize, method: 'document', sdkInt: 36 }; },
      verifySize: async ({ expectedSize }: any) => ({ exists: true, pending: 0, verified: true, actualSize: expectedSize }),
    });
    return { calls, saved, events };
  }, cancel);
  expect(result.calls).toHaveLength(1); expect(result.calls[0].expectedSize).toBe(7388734);
  expect(result.events).toHaveLength(1);
  expect(result.saved.saved).toBe(!cancel); expect(result.saved.sdkInt).toBe(36);
  expect(result.saved.diagnostics).toContain('MEDIASTORE_INSERT_FAILED');
  if (!cancel) { expect(result.saved.method).toBe('document'); expect(result.saved.relativePath).toBe('content://documents/chosen'); }
  else expect(result.saved.error).toContain('cancelled');
});
