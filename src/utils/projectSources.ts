import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ProjectData } from '../types/editor';
import { loadMediaRecord, saveMediaBlobToIdb } from './projectStorage';
import { createOwnedMediaUrl, revokeOwnedMediaUrl, getMediaAudit } from './mediaOwnership';

type Log = (step: string, detail: string) => void;
export interface MissingSource { key: string; blobId?: string; url?: string; name: string; kind: string }
export class MissingSourceError extends Error {
  constructor(public sources: MissingSource[]) {
    super(sources.map(s => 'Source ' + s.kind + ' missing: ' + s.name + '. Tap to relink / स्रोत गायब है: ' + s.name + '। दोबारा लिंक करें').join('\n'));
    this.name = 'MissingSourceError';
  }
}
export async function probeSourceUrl(url: string) {
  const scheme = url ? new URL(url, location.href).protocol : 'missing:';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    let statSize: number | undefined;
    if (Capacitor.isNativePlatform() && /^(file|content):/.test(url)) statSize = (await Filesystem.stat({ path: url })).size;
    const readable = /^(file|content):/.test(url) ? Capacitor.convertFileSrc(url) : url;
    if (!readable) throw new Error('No source URL');
    const response = await fetch(readable, { headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const reader = response.body?.getReader();
    if (reader) { await reader.read(); await reader.cancel(); }
    const rangeSize = Number(response.headers.get('content-range')?.split('/')[1]);
    const size = statSize ?? (Number.isFinite(rangeSize) ? rangeSize : Number(response.headers.get('content-length')) || undefined);
    return { exists: true, size, scheme, statSize };
  } catch (error) {
    return { exists: false, scheme, error: String(error) };
  } finally { clearTimeout(timer); }
}

/** An independent read lease: export cleanup can revoke only this lease's URLs. */
export async function resolveProjectSources(project: ProjectData, purpose: 'open' | 'export', log: Log,
  cancel = { current: false }) {
  const owner = purpose + ':' + crypto.randomUUID(), owned: string[] = [], missing: MissingSource[] = [];
  const clips = project.clips.map(c => ({ ...c }));
  const importedMedia = project.importedMedia?.map(m => ({ ...m }));
  const groups = new Map<string, { blobId?: string; url?: string; name: string; kind: string }>();
  for (const c of clips) if (c.sourceType.startsWith('uploaded-')) {
    const key = c.mediaBlobId || c.mediaUrl || c.id;
    groups.set(key, { blobId: c.mediaBlobId, url: c.mediaUrl, name: c.title, kind: c.sourceType.replace('uploaded-', '') });
  }
  for (const m of importedMedia || []) if (m.kind !== 'procedural') {
    const key = m.mediaBlobId || m.mediaUrl || m.id;
    groups.set(key, { blobId: m.mediaBlobId, url: m.mediaUrl, name: m.originalName || m.name, kind: m.kind });
  }
  const release = () => { for (const url of owned.splice(0)) revokeOwnedMediaUrl(url, owner); };
  try {
    for (const [key, source] of groups) {
      if (cancel.current) throw new DOMException('Export cancelled', 'AbortError');
      const original = await probeSourceUrl(source.url || '');
      const audit = getMediaAudit().filter(e => e.resource === source.url || e.resource === source.blobId);
      let record: Awaited<ReturnType<typeof loadMediaRecord>> = null;
      let url = source.url, nativeUri: string | undefined, id = source.blobId;
      try {
        record = source.blobId ? await loadMediaRecord(source.blobId) : null;
        // Migrate readable legacy URL-only projects on open, never during an export.
        if (!record && purpose === 'open' && original.exists) {
          const response = await fetch(/^(file|content):/.test(url || '') ? Capacitor.convertFileSrc(url!) : url!);
          if (!response.ok) throw new Error('Legacy source read failed');
          const blob = await response.blob();
          id = id || 'blob-' + crypto.randomUUID();
          await saveMediaBlobToIdb(id, new File([blob], source.name, { type: blob.type }));
          record = await loadMediaRecord(id);
        }
        if (record?.path) {
          const stat = await Filesystem.stat({ path: record.path, directory: Directory.Data });
          if (stat.size !== record.size || !stat.size) throw new Error('Stored source size mismatch');
          nativeUri = (await Filesystem.getUri({ path: record.path, directory: Directory.Data })).uri;
          url = Capacitor.convertFileSrc(nativeUri);
        } else if (record?.blob) {
          // Force a read so an old provider-backed File cannot masquerade as durable bytes.
          await record.blob.slice(0, 1).arrayBuffer();
          url = createOwnedMediaUrl(record.blob, owner); owned.push(url);
        } else if (source.blobId || !original.exists) throw new Error('Durable source not found');
        const resolved = await probeSourceUrl(url || '');
        if (!resolved.exists) throw new Error('Source unreadable: ' + resolved.error);
        log('source-check', JSON.stringify({ purpose, key, name: source.name, original, resolved,
          durable: !!record, size: record?.size || resolved.size, type: record?.type, path: record?.path, nativeUri,
          ownCleanup: [...audit, ...getMediaAudit().filter(e => e.resource === record?.path)] }));
        for (const c of clips) if ((c.mediaBlobId || c.mediaUrl || c.id) === key) {
          c.mediaUrl = url; c.mediaBlobId = id; c.mediaNativeUri = nativeUri;
        }
        for (const m of importedMedia || []) if ((m.mediaBlobId || m.mediaUrl || m.id) === key) {
          m.mediaUrl = url; m.mediaBlobId = id;
          if (record) { m.originalName = record.name; m.size = record.size; m.mimeType = record.type; }
        }
      } catch (error) {
        missing.push({ key, ...source });
        log('source-missing', JSON.stringify({ purpose, key, name: source.name, original, size: record?.size,
          path: record?.path, error: String(error), ownCleanup: [...audit, ...getMediaAudit().filter(e => e.resource === record?.path)] }));
      }
    }
    if (cancel.current) throw new DOMException('Export cancelled', 'AbortError');
    return { project: { ...project, clips, importedMedia }, missing, release };
  } catch (error) { release(); throw error; }
}

export async function relinkProjectSource(project: ProjectData, missing: MissingSource, file: File) {
  const requiredPrefix = missing.kind === 'image' ? 'image/' : missing.kind === 'audio' ? 'audio/' : 'video/';
  if (!file.type.startsWith(requiredPrefix)) throw new Error('Select the same media type / उसी प्रकार की मीडिया फ़ाइल चुनें');
  const id = 'blob-' + crypto.randomUUID();
  await saveMediaBlobToIdb(id, file);
  const matches = (item: { mediaBlobId?: string; mediaUrl?: string; id: string }) =>
    (item.mediaBlobId || item.mediaUrl || item.id) === missing.key;
  return { ...project,
    clips: project.clips.map(c => matches(c) ? { ...c, mediaBlobId: id, mediaUrl: undefined, mediaNativeUri: undefined } : c),
    importedMedia: project.importedMedia?.map(m => matches(m) ? { ...m, mediaBlobId: id, mediaUrl: undefined,
      originalName: file.name, size: file.size, mimeType: file.type } : m),
  };
}
