import { resolveProjectSources, MissingSourceError } from '../utils/projectSources';
import { Capacitor } from '@capacitor/core';
import type { ProjectData } from '../types/editor';
import type { ExportOptions } from './exportEngine';
import { clearExportLog, getExportLog, logExport, markLadderStrategy } from './exportEngine';
import { encodeWebCodecs } from './webCodecsExport';
import { encodeRecorder } from './recorderExport';
import { exportNative, nativeExportAvailable, type NativeResult } from './nativeExport';
import { verifyOutput, type FileVerification } from './verifyOutput';
import { abortIfCancelled, type CancelFlag } from './exportMedia';
import { trace } from '../utils/crashTrace';

export interface VerifiedExport {
  blob?: Blob; native?: NativeResult; format: string; resolution: string;
  size: number; duration: number; frames: number; hasAudio: boolean; verification: FileVerification;
}

export async function exportProject(project: ProjectData, format: 'mp4' | 'webm', cancel: CancelFlag,
  progress: (pct: number) => void, mode: 'auto' | 'native' = 'auto', preferNative = false): Promise<VerifiedExport> {
  clearExportLog(); trace('export-started', 'mode=' + mode);
  let sourceLease: Awaited<ReturnType<typeof resolveProjectSources>> | undefined;
  const native = async (): Promise<VerifiedExport> => {
    logExport('fallback', 'Starting native Media3 export');
    const r = await exportNative(project, cancel, logExport, progress);
    markLadderStrategy('e', 'ok', 'native-verified', JSON.stringify(r));
    return { native: r, format: 'MP4 (Android)', resolution: r.width + '×' + r.height,
      size: r.size, duration: r.duration, frames: r.frames, hasAudio: r.hasAudio,
      verification: { ok: r.verified, duration: r.duration, frames: r.frames,
        hasAudio: r.hasAudio, framesChanging: r.framesChanging, error: null } };
  };
  const web = async (recorder: boolean): Promise<VerifiedExport> => {
    let result: Parameters<ExportOptions['onResult']>[0] | undefined;
    const options: ExportOptions = {
      project, format, canvas: document.createElement('canvas'), mediaElementCache: new Map(), audioElementsRef: new Map(),
      cancelRef: cancel, safeMode: false, onProgress: progress,
      onResult: r => { result = r; }, onError: message => { throw new Error(message); },
    };
    await (recorder ? encodeRecorder : encodeWebCodecs)(options, logExport);
    abortIfCancelled(cancel);
    if (!result) throw new Error('Encoder produced no output');
    progress(95);
    const expectedAudio = result.hasAudio || project.clips.some(c => c.trackType === 'audio' && !c.muted && c.volume > 0);
    const expectMotion = project.clips.some(c => !c.muted && !c.frozen &&
      ['uploaded-video', 'procedural-scene'].includes(c.sourceType));
    const verification = await verifyOutput(result.blob, result.duration, expectedAudio, expectMotion, cancel, logExport);
    abortIfCancelled(cancel);
    if (!verification.ok) throw new Error(verification.error || 'Output verification failed');
    return { ...result, frames: verification.frames || result.frames, duration: verification.duration,
      hasAudio: verification.hasAudio, verification };
  };
  try {
    sourceLease = await resolveProjectSources(project, 'export', logExport, cancel);
    if (sourceLease.missing.length) throw new MissingSourceError(sourceLease.missing);
    project = sourceLease.project;
    let result: VerifiedExport;
    if (mode === 'native' || (preferNative && nativeExportAvailable())) result = await native();
    else {
      try { result = await web(format === 'webm'); }
      catch (err) {
        abortIfCancelled(cancel);
        logExport('webview-failed', err instanceof Error ? err.message : String(err));
        if (Capacitor.getPlatform() === 'android') result = await native();
        else if (format !== 'webm') {
          logExport('fallback', 'Using browser MediaRecorder');
          result = await web(true);
        } else throw err;
      }
    }
    abortIfCancelled(cancel);
    trace('export-finished', 'verified'); progress(100); return result;
  } catch (err) {
    logExport('export-error', err instanceof Error ? err.message : String(err));
    trace('export-finished', cancel.current ? 'cancelled' : 'failed');
    throw err;
  } finally { sourceLease?.release(); }
}
