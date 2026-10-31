import { Directory, Filesystem } from '@capacitor/filesystem';

export interface MediaAuditEntry { ts: number; action: string; resource: string; owner: string; detail?: string }
const KEY = 'clipnova_media_audit_v1';
const urls = new Map<string, string>();
export const revokedSourceUrls = new Set<string>();
export const deletedMediaFiles = new Set<string>();
export function getMediaAudit(): MediaAuditEntry[] {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(entries) ? entries.filter(e => e && typeof e.resource === 'string' && typeof e.owner === 'string') : [];
  } catch { return []; }
}
export function auditMedia(action: string, resource: string, owner: string, detail?: string) {
  const entry = { ts: Date.now(), action, resource, owner, detail };
  try { localStorage.setItem(KEY, JSON.stringify([...getMediaAudit(), entry].slice(-160))); } catch {}
}
export function createOwnedMediaUrl(blob: Blob, owner: string): string {
  const url = URL.createObjectURL(blob); urls.set(url, owner); return url;
}
export function revokeOwnedMediaUrl(url: string, owner: string) {
  if (urls.get(url) !== owner) { auditMedia('revoke-blocked', url, owner, 'URL belongs to another owner'); return; }
  URL.revokeObjectURL(url); urls.delete(url); revokedSourceUrls.add(url);
  auditMedia('revoked', url, owner);
}
export async function deleteExportTemp(path: string, owner: string,
  filesystem: Pick<typeof Filesystem, 'deleteFile'> = Filesystem) {
  if (!/^(clipnova-exports\/|clipnova-native-[^/]+\/)/.test(path) || path.split('/').includes('..'))
    throw new Error('Refusing to delete a non-export file: ' + path);
  await filesystem.deleteFile({ path, directory: Directory.Cache });
  deletedMediaFiles.add(path); auditMedia('deleted', path, owner);
}
