import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getMediaSaverPlugin, isAndroidNativeApp, publishExportPath, uniqueExportName, type MediaSaverPlugin } from '../utils/androidBridge';
import { logExport } from './exportEngine';

export interface FinishedExport {
  id: string; name: string; size: number; mimeType: string; date: string;
  uri: string; retainedUri?: string; path?: string; status: 'saved' | 'not-saved' | 'failed'; error?: string; diagnostics?: string;
}
type OutputDependencies = {
  native: boolean; filesystem: Pick<typeof Filesystem, 'writeFile' | 'appendFile' | 'stat' | 'getUri' | 'deleteFile'>;
  mediaSaver: MediaSaverPlugin | null;
};
declare global { interface Window { __clipnovaSaveDependencies?: OutputDependencies; } }
const dependencies = (): OutputDependencies => import.meta.env.VITE_TEST_MODE === 'true' && window.__clipnovaSaveDependencies
  ? window.__clipnovaSaveDependencies : { native: isAndroidNativeApp(), filesystem: Filesystem, mediaSaver: getMediaSaverPlugin() };
export const automaticGallerySave = () => dependencies().native;
const key = 'clipnova_my_exports';
export function listFinishedExports(): FinishedExport[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]').map((e: FinishedExport) => ({ ...e, id: e.id || e.uri, status: e.status || 'saved' }));
  } catch { return []; }
}
export function recordFinishedExport(entry: FinishedExport) {
  const list = listFinishedExports().filter(e => e.id !== entry.id);
  localStorage.setItem(key, JSON.stringify([entry, ...list]));
  window.dispatchEvent(new Event('clipnova-exports-changed'));
  return entry;
}
async function blobStore(id: string, blob?: Blob, remove = false): Promise<Blob | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('clipnova_finished_outputs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('outputs');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('outputs', blob || remove ? 'readwrite' : 'readonly'), store = tx.objectStore('outputs');
      const request = remove ? store.delete(id) : blob ? store.put(blob, id) : store.get(id);
      tx.oncomplete = () => resolve(blob || request.result);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
});
/** Only finished outputs live here; imported sources are never accepted or cleaned. */
export async function retainFinishedExport(blob: Blob, title: string): Promise<FinishedExport> {
  const ext = blob.type.includes('mp4') ? '.mp4' : '.webm';
  let entry: FinishedExport = { id: crypto.randomUUID(), name: uniqueExportName(title + ext), size: blob.size,
    mimeType: blob.type || 'video/mp4', date: new Date().toISOString(), uri: '', status: 'not-saved' };
  recordFinishedExport(entry);
  const deps = dependencies();
  try {
    if (!blob.size) throw new Error('Finished export is empty');
    if (deps.native) {
      const path = 'clipnova-outputs/' + entry.name;
      for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
        const data = await base64(blob.slice(offset, offset + 1024 * 1024));
        if (offset === 0) await deps.filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
        else await deps.filesystem.appendFile({ path, data, directory: Directory.Data });
      }
      const stat = await deps.filesystem.stat({ path, directory: Directory.Data });
      if (stat.size !== blob.size) throw new Error('Retained output size mismatch: ' + stat.size + '/' + blob.size);
      const { uri } = await deps.filesystem.getUri({ path, directory: Directory.Data });
      entry = { ...entry, path, retainedUri: uri, uri };
    } else {
      await blobStore(entry.id, blob);
      entry.retainedUri = entry.uri = 'indexeddb:clipnova_finished_outputs/' + entry.id;
    }
    logExport('output-retained', JSON.stringify({ name: entry.name, uri: entry.uri, bytes: entry.size }));
    return recordFinishedExport(entry);
  } catch (error) {
    entry = { ...entry, status: 'failed', error: 'Could not retain finished output: ' + String(error) };
    recordFinishedExport(entry); logExport('save-error', JSON.stringify(entry)); throw new Error(entry.error);
  }
}
export async function retainNativeExport(result: { uri: string; name: string; size: number }) {
  const file = result.uri.replace(/^file:\/\//, '');
  if (!file.includes('/clipnova-outputs/')) throw new Error('Native finished file is outside retained output storage');
  const stat = await dependencies().filesystem.stat({ path: file });
  if (stat.size !== result.size) throw new Error('Native retained output size mismatch');
  return recordFinishedExport({ id: crypto.randomUUID(), name: result.name, size: result.size, mimeType: 'video/mp4',
    date: new Date().toISOString(), uri: result.uri, retainedUri: result.uri, path: 'clipnova-outputs/' + result.name, status: 'not-saved' });
}
export async function saveFinishedExport(entry: FinishedExport, saveAs = false): Promise<FinishedExport> {
  const deps = dependencies();
  if (!deps.native) {
    const blob = await blobStore(entry.id);
    if (!blob) return recordFinishedExport({ ...entry, status: 'failed', error: 'Retained output is missing' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = entry.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    // Browsers cannot confirm where a download was saved. Keep the durable copy and honest status.
    return entry;
  }
  if (!deps.mediaSaver || !entry.retainedUri) {
    const failed: FinishedExport = { ...entry, status: 'failed', error: 'MediaSaver or retained output unavailable' };
    logExport('save-error', JSON.stringify(failed)); return recordFinishedExport(failed);
  }
  const result = await publishExportPath(entry.retainedUri, entry.name, entry.mimeType, entry.size, deps.mediaSaver, saveAs);
  return recordFinishedExport({ ...entry, status: result.saved ? 'saved' : 'failed',
    name: result.saved && result.relativePath?.startsWith('Movies/ClipNova/') ? result.relativePath.split('/').pop()! : entry.name,
    uri: result.saved ? result.uri! : entry.retainedUri, error: result.error || undefined, diagnostics: result.diagnostics });
}
export async function discardFinishedExport(entry: FinishedExport) {
  if (entry.path) {
    if (!entry.path.startsWith('clipnova-outputs/') || entry.path.includes('..')) throw new Error('Invalid retained output path');
    await dependencies().filesystem.deleteFile({ path: entry.path, directory: Directory.Data });
  } else if (entry.retainedUri?.startsWith('indexeddb:')) await blobStore(entry.id, undefined, true);
  localStorage.setItem(key, JSON.stringify(listFinishedExports().filter(e => e.id !== entry.id)));
  window.dispatchEvent(new Event('clipnova-exports-changed'));
}
export async function getFinishedExportBlob(entry: FinishedExport) {
  if (entry.retainedUri?.startsWith('indexeddb:')) return blobStore(entry.id);
  if (!entry.retainedUri) return undefined;
  const response = await fetch(Capacitor.convertFileSrc(entry.retainedUri));
  if (!response.ok) throw new Error('Retained export cannot be read');
  return response.blob();
}
