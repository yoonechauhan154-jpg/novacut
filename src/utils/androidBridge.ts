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
interface MediaSaverPlugin {
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
  verifySize(opts: { uri: string; expectedSize: number }): Promise<{
    uri: string;
    actualSize: number;
    expectedSize: number;
    verified: boolean;
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
  method: 'mediastore' | 'legacy-public-movies' | 'filesystem' | 'download';
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
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
export async function saveToMediaStore(
  blob: Blob,
  fileName: string,
  mimeType: string = 'video/mp4'
): Promise<MediaSaveResult> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cachePath = `clipnova-exports/${safeName}`;
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

  const isNative = isAndroidNativeApp();
  const MediaSaver = isNative ? getMediaSaverPlugin() : null;

  try {
    // 1. Write the blob to the app cache in 2 MiB base64 chunks.
    const CHUNK = 2 * 1024 * 1024;
    let offset = 0;
    let first = true;
    while (offset < blob.size) {
      const chunk = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      const base64 = await blobToBase64(chunk);
      if (first) {
        await Filesystem.writeFile({
          path: cachePath,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        first = false;
      } else {
        await Filesystem.appendFile({
          path: cachePath,
          data: base64,
          directory: Directory.Cache,
        });
      }
      offset += chunk.size;
    }

    const uriRes = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
    const filePath = (uriRes.uri || '').replace(/^file:\/\//, '');
    if (!filePath) throw new Error('Could not resolve cache file path');

    // 2. Native MediaStore path.
    if (MediaSaver) {
      const saved = await MediaSaver.saveVideo({
        path: filePath,
        displayName: safeName,
        mimeType,
        expectedSize: blob.size,
      });
      result.uri = saved.uri || null;
      result.size = saved.size ?? blob.size;
      result.relativePath = saved.relativePath || null;
      result.sdkInt = saved.sdkInt != null ? Number(saved.sdkInt) : null;
      result.method = (saved.method || 'mediastore') as MediaSaveResult['method'];

      // 3. Verify the published file size against the blob size.
      const verify = await MediaSaver.verifySize({ uri: result.uri, expectedSize: blob.size });
      result.verified = verify.verified ?? null;

      // 4. Remove the temp cache file.
      try {
        await Filesystem.deleteFile({ path: cachePath, directory: Directory.Cache });
      } catch {
        // ignore — temp file cleanup is best effort
      }

      result.saved = true;
      if (result.verified === false) {
        result.error = `Saved but MediaStore size mismatch: expected ${blob.size} bytes, got ${result.size}`;
      }
      return result;
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
    try { await Filesystem.deleteFile({ path: cachePath, directory: Directory.Cache }); } catch {}
    return result;
  }
}
