import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isAndroidNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initAndroidNativeBridge(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#090D14' });
  } catch {
    // Ignore on platforms where StatusBar plugin is unavailable
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
 * Saves an exported video (.webm) or project archive (.json / .md) to the Android
 * phone's storage using Capacitor Filesystem and opens the native Android Share sheet,
 * or falls back to standard browser download when running on the web.
 */
export async function saveAndShareFileOnDevice(
  blob: Blob,
  fileName: string,
  title: string = 'ClipNova Export'
): Promise<{ savedPath: string; shared: boolean }> {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = await blobToBase64(blob);
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

      // Write to Documents (or Cache fallback) on Android
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
        return { savedPath: writeResult.uri, shared: true };
      } catch {
        return { savedPath: writeResult.uri, shared: false };
      }
    } catch (err) {
      console.error('Native filesystem save failed, falling back to browser download:', err);
    }
  }

  // Standard Web Browser Fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { savedPath: fileName, shared: false };
}
