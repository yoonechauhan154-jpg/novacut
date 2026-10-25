import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

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

const CapApp = registerPlugin<CapacitorAppPlugin>('App');

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
