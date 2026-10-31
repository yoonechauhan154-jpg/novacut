import { logExport } from '../export/exportEngine';
import { createOwnedMediaUrl, revokeOwnedMediaUrl, deleteExportTemp } from './mediaOwnership';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

export const BUILD_ID: string =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env.VITE_BUILD_ID as string)) ||
  'dev';

interface CapacitorAppPlugin {
  addListener?: (
    eventName: 'backButton',
    listenerFunc: (data: { canGoBack: boolean }) => void
  ) => Promise<{ remove: () => void }> | { remove: () => void };
  exitApp?: () => Promise<void>;
}

/** Custom native plugin (MediaSaverPlugin, registered in MainActivity). */
export interface MediaSaverPlugin {
  beginDocument(opts: { displayName: string; mimeType: string; expectedSize: number }): Promise<{ id: string; uri: string; sdkInt: number }>;
  writeDocumentChunk(opts: { id: string; data: string }): Promise<{ written: number }>;
  finishDocument(opts: { id: string }): Promise<{ uri: string; size: number; method: string; sdkInt: number }>;
  abortDocument(opts: { id: string }): Promise<void>;
  saveVideo(opts: {
    path: string;
    displayName: string;
    mimeType: string;
    expectedSize: number;
  }): Promise<{
    uri: string;
    size: number;
    expectedSize: number;
    relativePath: string;
    method: string;
    sdkInt: number;
  }>;
  saveAs(opts: { path: string; displayName: string; mimeType: string; expectedSize: number }): Promise<{ uri: string; size: number; method: string; sdkInt: number }>;
  verifySize(opts: { uri: string; expectedSize: number }): Promise<{
    uri: string;
    actualSize: number;
    expectedSize: number;
    verified: boolean;
    exists?: boolean;
    pending?: number;
  }>;
  openUri(opts: { uri: string; mimeType: string }): Promise<void>;
  shareUri(opts: { uri: string; title: string; text: string; mimeType: string }): Promise<void>;
}

const registeredMediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver');

export function getMediaSaverPlugin(): MediaSaverPlugin | null {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('MediaSaver') ? registeredMediaSaver : null;
}

declare module '@capacitor/core' {
  interface PluginRegistry {
    MediaSaver?: MediaSaverPlugin;
  }
}

export interface MediaSaveResult {
  saved: boolean;
  method: 'mediastore' | 'legacy-public-movies' | 'filesystem' | 'download' | 'document';
  diagnostics?: string;
  uri: string | null;
  size: number;
  relativePath: string | null;
  sdkInt: number | null;
  verified: boolean | null;
  error: string | null;
}

let CapApp: CapacitorAppPlugin | null = null;
try {
  CapApp = App as unknown as CapacitorAppPlugin;
} catch {
  CapApp = null;
}

export function isAndroidNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function initAndroidNativeBridge(): Promise<void> {
  if (!isAndroidNativeApp()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#070A10' });
  } catch {
    // Ignore on platforms where StatusBar plugin is unavailable
  }
}

/**
 * Registers a hardware back button listener for Android WebView & Capacitor.
 * Flow: close open bottom sheet/modal -> save & exit Editor to Home -> show Exit Confirmation on Home.
 */
export function registerHardwareBackButton(onBack: () => void): () => void {
  let pluginListenerHandle: { remove: () => void } | null = null;

  try {
    if (CapApp && typeof CapApp.addListener === 'function') {
      const maybePromise = CapApp.addListener('backButton', () => {
        onBack();
      });
      if (maybePromise && typeof (maybePromise as Promise<{ remove: () => void }>).then === 'function') {
        (maybePromise as Promise<{ remove: () => void }>)
          .then((h) => {
            pluginListenerHandle = h;
          })
          .catch(() => {});
      } else if (maybePromise) {
        pluginListenerHandle = maybePromise as { remove: () => void };
      }
    }
  } catch {
    // Fallback to document backbutton event below
  }

  const handleDocBackButton = (e: Event) => {
    e.preventDefault();
    onBack();
  };

  document.addEventListener('backbutton', handleDocBackButton, false);

  return () => {
    document.removeEventListener('backbutton', handleDocBackButton, false);
    try {
      pluginListenerHandle?.remove();
    } catch {
      // ignore
    }
  };
}

export async function exitAndroidApp(): Promise<void> {
  try {
    if (CapApp && typeof CapApp.exitApp === 'function') {
      await CapApp.exitApp();
      return;
    }
  } catch {
    // ignore
  }
  try {
    const nav = navigator as unknown as { app?: { exitApp?: () => void } };
    if (nav.app?.exitApp) {
      nav.app.exitApp();
    }
  } catch {
    // ignore
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64Data = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves an exported video (.webm) or project archive (.json / .srt / .fcpxml / .md)
 * to the Android phone's storage (Documents/ClipNova) using Capacitor Filesystem
 * and opens the native Share sheet, or falls back to browser download.
 */
export async function saveAndShareFileOnDevice(
  blob: Blob,
  fileName: string,
  title: string = 'ClipNova Export'
): Promise<{ saved: boolean; savedPath: string; shared: boolean }> {
  const safeName = uniqueExportName(fileName);

  if (isAndroidNativeApp()) {
    try {
      const base64Data = await blobToBase64(blob);

      let writeResult;
      try {
        writeResult = await Filesystem.writeFile({
          path: `ClipNova/${safeName}`,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch {
        writeResult = await Filesystem.writeFile({
          path: safeName,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        });
      }

      try {
        await Share.share({
          title,
          text: `Exported from ClipNova: ${safeName}`,
          url: writeResult.uri,
          dialogTitle: title,
        });
        return { saved: true, savedPath: writeResult.uri, shared: true };
      } catch {
        return { saved: true, savedPath: writeResult.uri, shared: false };
      }
    } catch (err) {
      console.error('Native filesystem save failed, falling back to browser download:', err);
    }
  }

  // Standard Web Browser Fallback
  const url = createOwnedMediaUrl(blob, 'saveAndShareFileOnDevice.download');
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => revokeOwnedMediaUrl(url, 'saveAndShareFileOnDevice.download'), 5000);
  return { saved: true, savedPath: safeName, shared: false };
}

/**
 * Save an exported video blob so it lands in the public Movies/ClipNova folder
 * and shows up in Gallery and Files.
 *
 * The blob (potentially 100 MB+) is never sent across the bridge as base64.
 * Instead it is written to the app cache directory in 2 MiB base64 chunks via
 * the Capacitor Filesystem plugin, then MediaSaverPlugin copies the cache file
 * into MediaStore (API 29+: IS_PENDING insert, no storage permission needed;
 * API 28-: public Movies directory + MediaScannerConnection). The temp file is
 * deleted afterwards. The saved file is verified against MediaStore SIZE and
 * the result carries the content URI, size, API level and method so the UI can
 * show an honest "Saved to Movies/ClipNova" dialog or an exact error.
 */
export interface MediaSaveDependencies {
  filesystem: Pick<typeof Filesystem, 'writeFile' | 'appendFile' | 'getUri' | 'deleteFile'>;
  mediaSaver: Pick<MediaSaverPlugin, 'saveVideo' | 'verifySize'> | null;
  native: boolean;
}

export async function saveToMediaStore(
  blob: Blob,
  fileName: string,
  mimeType: string = 'video/mp4',
  dependencies?: MediaSaveDependencies
): Promise<MediaSaveResult> {
  const safeName = uniqueExportName(fileName);
  const cachePath = `clipnova-exports/${crypto.randomUUID()}-${safeName}`;
  const filesystem = dependencies?.filesystem || Filesystem;
  const result: MediaSaveResult = {
    saved: false,
    method: 'download',
    uri: null,
    size: blob.size,
    relativePath: null,
    sdkInt: null,
    verified: null,
    error: null,
  };

  const isNative = dependencies?.native ?? isAndroidNativeApp();
  const MediaSaver = dependencies ? dependencies.mediaSaver : isNative ? getMediaSaverPlugin() : null;

  try {
    // 1. Write the blob to the app cache in 2 MiB base64 chunks.
    const CHUNK = 2 * 1024 * 1024;
    let offset = 0;
    let first = true;
    while (offset < blob.size) {
      const chunk = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      const base64 = await blobToBase64(chunk);
      if (first) {
        await filesystem.writeFile({
          path: cachePath,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        first = false;
      } else {
        await filesystem.appendFile({
          path: cachePath,
          data: base64,
          directory: Directory.Cache,
        });
      }
      offset += chunk.size;
    }

    const uriRes = await filesystem.getUri({ path: cachePath, directory: Directory.Cache });
    const filePath = (uriRes.uri || '').replace(/^file:\/\//, '');
    if (!filePath) throw new Error('Could not resolve cache file path');

    // 2. Native MediaStore path.
    if (MediaSaver) {
      const published = await publishExportPath(filePath, safeName, mimeType, blob.size, MediaSaver);
      try { await deleteExportTemp(cachePath, 'saveToMediaStore.cleanup', filesystem); } catch {}
      return published;
    }

    // 5. No native plugin (e.g. browser or older build): keep the previous
    //    Documents + share behavior, clearly labeled.
    const fallback = await saveAndShareFileOnDevice(blob, fileName, 'ClipNova Video Export');
    result.saved = fallback.saved;
    result.method = 'filesystem';
    result.uri = fallback.savedPath || null;
    result.relativePath = `Documents/ClipNova/${fileName}`;
    result.verified = null;
    if (!fallback.saved) result.error = 'Native save plugin unavailable and filesystem fallback failed';
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    result.saved = false;
    // Best-effort cleanup of the partial temp file.
    try { await deleteExportTemp(cachePath, 'saveToMediaStore.cleanup', filesystem); } catch {}
    return result;
  }
}

/** Timestamp plus random suffix, including repeated saves within the same millisecond. */
export function uniqueExportName(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dot = safe.lastIndexOf('.');
  const stem = (dot >= 0 ? safe.slice(0, dot) : safe).slice(0, 80) || 'ClipNova';
  const ext = dot >= 0 ? safe.slice(dot) : '.mp4';
  return stem + '-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + ext;
}
export async function publishExportPath(path: string, name: string, mimeType: string, size: number,
  saver: Pick<MediaSaverPlugin, 'saveVideo' | 'verifySize'> & Partial<Pick<MediaSaverPlugin, 'saveAs'>>,
  saveAs = false): Promise<MediaSaveResult> {
  const diagnostic: Record<string, unknown> = { method: saveAs ? 'document' : 'mediastore', displayName: name, path, expectedSize: size };
  const result: MediaSaveResult = { saved: false, method: saveAs ? 'document' : 'mediastore', uri: null,
    size, relativePath: null, sdkInt: null, verified: false, error: null };
  try {
    if (size <= 0) throw new Error('Finished export is empty');
    const options = { path: path.replace(/^file:\/\//, ''), displayName: name, mimeType, expectedSize: size };
    if (saveAs && !saver.saveAs) throw new Error('Save as is unavailable in this Android build');
    const saved = saveAs ? await saver.saveAs!(options) : await saver.saveVideo(options);
    Object.assign(diagnostic, { uri: saved.uri, bytesWritten: saved.size, apiLevel: saved.sdkInt, method: saved.method,
      requestedDisplayName: name, displayName: 'relativePath' in saved ? saved.relativePath?.split('/').pop() || name : name });
    if (!saved.uri) throw new Error('MediaStore did not return a saved file URI');
    if (saved.size !== size) throw new Error('Save byte count mismatch: expected ' + size + ', wrote ' + saved.size);
    const query = await saver.verifySize({ uri: saved.uri, expectedSize: size });
    diagnostic.query = query;
    if (!query.verified || query.actualSize !== size || query.exists !== true || query.pending !== 0)
      throw new Error('Saved file is not published or size mismatch: ' + JSON.stringify(query));
    Object.assign(result, { saved: true, verified: true, uri: saved.uri, sdkInt: Number(saved.sdkInt),
      method: saved.method || result.method, relativePath: 'relativePath' in saved ? saved.relativePath : saved.uri });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    diagnostic.exception = result.error;
    const nativeStart = result.error.indexOf('{');
    if (nativeStart >= 0) { try { diagnostic.native = JSON.parse(result.error.slice(nativeStart)); } catch {} }
    if (diagnostic.apiLevel == null) diagnostic.apiLevel = Number(result.error.match(/API (\d+)/)?.[1]) || null;
  }
  result.diagnostics = JSON.stringify(diagnostic);
  logExport(result.saved ? 'save-verified' : 'save-error', result.diagnostics);
  return result;
}
