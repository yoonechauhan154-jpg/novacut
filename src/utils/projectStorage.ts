import { ProjectData } from '../types/editor';

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

export async function saveMediaBlobToIdb(blobId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(blob, blobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IDB blob quota errors gracefully
  }
}

export async function loadMediaBlobFromIdb(blobId: string): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    const result = await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const req = tx.objectStore(STORE_BLOBS).get(blobId);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
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
