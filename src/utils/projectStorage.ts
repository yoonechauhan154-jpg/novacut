import { ProjectData } from '../types/editor';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { auditMedia } from './mediaOwnership';

const DB_NAME = 'clipnova_idb_v3';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'media_blobs';
const LS_FALLBACK_KEY = 'clipnova_projects_fallback_v3';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export function isValidProjectData(item: unknown): item is ProjectData {
  if (!item || typeof item !== 'object') return false;
  const p = item as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    Array.isArray(p.clips) &&
    typeof p.aspectRatio === 'string'
  );
}

export interface StoredMedia {
  version: 1; name: string; size: number; type: string; blob?: Blob; path?: string;
}
export async function loadMediaRecord(blobId: string): Promise<StoredMedia | null> {
  const db = await openDatabase();
  try {
    const value = await new Promise<Blob | StoredMedia | undefined>((resolve, reject) => {
      const req = db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS).get(blobId);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    // Old databases store a raw File/Blob. Keep them readable for migration/relink.
    if (value instanceof Blob) return { version: 1, blob: value, size: value.size, type: value.type,
      name: value instanceof File ? value.name : blobId };
    return value || null;
  } finally { db.close(); }
}
export async function saveMediaBlobToIdb(blobId: string, blob: Blob): Promise<void> {
  if (!blob.size) throw new Error('Source file is empty');
  const record: StoredMedia = { version: 1, name: blob instanceof File ? blob.name : blobId,
    size: blob.size, type: blob.type };
  const chunkSize = 1024 * 1024;
  // Materialize bytes: a picker File can be backed by a temporary provider handle.
  // Android owns a copy in Data, never Cache. Browser IDB owns detached byte chunks.
  if (Capacitor.isNativePlatform()) {
    record.path = 'clipnova-sources/' + crypto.randomUUID() + '.media';
    try {
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const chunk = new Blob([await blob.slice(offset, offset + chunkSize).arrayBuffer()]);
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(chunk);
        });
        if (offset === 0) await Filesystem.writeFile({ path: record.path, directory: Directory.Data, data, recursive: true });
        else await Filesystem.appendFile({ path: record.path, directory: Directory.Data, data });
      }
      const stat = await Filesystem.stat({ path: record.path, directory: Directory.Data });
      if (stat.size !== blob.size) throw new Error('Durable source copy size mismatch');
    } catch (error) {
      try { await Filesystem.deleteFile({ path: record.path, directory: Directory.Data });
        auditMedia('deleted', record.path, 'saveMediaBlobToIdb.failedNewCopy'); } catch {}
      throw error;
    }
  } else {
    const parts: ArrayBuffer[] = [];
    for (let offset = 0; offset < blob.size; offset += chunkSize)
      parts.push(await blob.slice(offset, offset + chunkSize).arrayBuffer());
    record.blob = new Blob(parts, { type: blob.type });
    try { await navigator.storage?.persist?.(); } catch {}
  }
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(record, blobId);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Source storage aborted'));
    });
    auditMedia('persisted', record.path || blobId, 'saveMediaBlobToIdb', record.name + ' bytes=' + record.size);
  } catch (error) {
    if (record.path) try { await Filesystem.deleteFile({ path: record.path, directory: Directory.Data });
      auditMedia('deleted', record.path, 'saveMediaBlobToIdb.failedNewRecord'); } catch {}
    throw error; // An import must not claim success without its durable bytes.
  } finally { db?.close(); }
}
export async function loadMediaBlobFromIdb(blobId: string): Promise<Blob | null> {
  const record = await loadMediaRecord(blobId);
  if (!record) return null;
  if (record.blob) return record.blob;
  if (record.path) {
    const uri = await Filesystem.getUri({ path: record.path, directory: Directory.Data });
    const response = await fetch(Capacitor.convertFileSrc(uri.uri));
    if (!response.ok) throw new Error('Stored source read failed: ' + response.status);
    const blob = await response.blob();
    if (blob.size !== record.size) throw new Error('Stored source size mismatch');
    return blob.type === record.type ? blob : new Blob([blob], { type: record.type });
  }
  return null;
}

export async function loadAllProjectsFromStorage(
  onWarning?: (msg: string) => void
): Promise<ProjectData[]> {
  const validProjects: ProjectData[] = [];

  try {
    const db = await openDatabase();
    const rawItems = await new Promise<unknown[]>((resolve) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    db.close();

    for (const item of rawItems) {
      if (isValidProjectData(item)) {
        validProjects.push(item);
      } else if (onWarning) {
        onWarning('Skipped 1 corrupted project entry in IndexedDB.');
      }
    }

    if (validProjects.length > 0) {
      return validProjects.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
  } catch {
    // Fallback to localStorage below
  }

  try {
    const rawStr = localStorage.getItem(LS_FALLBACK_KEY);
    if (!rawStr) return [];
    const parsed = JSON.parse(rawStr);
    if (!Array.isArray(parsed)) return [];
    for (const item of parsed) {
      if (isValidProjectData(item)) {
        validProjects.push(item);
      } else if (onWarning) {
        onWarning('Skipped 1 corrupted project entry in localStorage.');
      }
    }
  } catch {
    if (onWarning) {
      onWarning('Recovered from unreadable localStorage project cache.');
    }
  }

  return validProjects.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function saveProjectToStorage(project: ProjectData): Promise<void> {
  if (!isValidProjectData(project)) return;

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IDB failure and also write to localStorage fallback
  }

  try {
    const rawStr = localStorage.getItem(LS_FALLBACK_KEY);
    const existing: ProjectData[] = rawStr ? JSON.parse(rawStr) : [];
    const safeList = Array.isArray(existing) ? existing.filter(isValidProjectData) : [];
    const idx = safeList.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      safeList[idx] = project;
    } else {
      safeList.unshift(project);
    }
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(safeList.slice(0, 25)));
  } catch {
    // Ignore localStorage quota exceeded
  }
}

export async function deleteProjectFromStorage(projectId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    const rawStr = localStorage.getItem(LS_FALLBACK_KEY);
    if (!rawStr) return;
    const existing = JSON.parse(rawStr);
    if (Array.isArray(existing)) {
      const next = existing.filter((p) => p && p.id !== projectId);
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}
