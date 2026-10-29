import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ProjectData, TimelineClip } from '../types/editor';
import { getAspectDimensions, renderProjectFrame } from '../utils/canvasRenderer';
import { abortIfCancelled, type CancelFlag, type Diagnostic } from './exportMedia';

export interface NativeResult {
  uri: string; name: string; size: number; duration: number; frames: number;
  hasAudio: boolean; framesChanging: boolean; width: number; height: number; verified: boolean;
}
interface NativeExportPlugin {
  exportVideo(options: { plan: unknown }): Promise<NativeResult>;
  cancel(): Promise<void>;
  addListener(event: 'progress', cb: (event: { progress: number }) => void): Promise<PluginListenerHandle>;
}
const NativeExporter = registerPlugin<NativeExportPlugin>('NativeExporter');
export const nativeExportAvailable = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativeExporter');

export function nativeUnsupported(project: ProjectData): string[] {
  const reasons: string[] = [];
  const main = project.clips.filter(c => c.trackType === 'video' && !c.muted).sort((a, b) => a.startTime - b.startTime);
  if (!main.length) reasons.push('Native export needs an imported main-track video or image');
  let end = 0;
  for (const c of main) {
    if (Math.abs(c.startTime - end) > 0.02) reasons.push('Main-track gaps or overlaps: ' + c.title);
    end = c.startTime + c.duration;
  }
  for (const c of project.clips.filter(c => !c.muted)) {
    const label = c.title + ' (' + c.id + ')';
    const base = c.trackType === 'video', audio = c.trackType === 'audio';
    const staticOverlay = c.trackType === 'text' || c.trackType === 'sticker' ||
      (c.trackType === 'overlay' && c.sourceType === 'uploaded-image');
    if (!(base || audio || staticOverlay)) reasons.push('Unsupported native layer: ' + label);
    if (base && !['uploaded-video', 'uploaded-image'].includes(c.sourceType)) reasons.push('Procedural source: ' + label);
    if (audio && c.sourceType !== 'uploaded-audio') reasons.push('Synthetic audio: ' + label);
    if (c.reversed || c.frozen || c.speedCurve !== 'normal' || c.keyframes.length ||
        c.effect !== 'none' || c.transitionIn !== 'none' || c.motionTrackTargetId)
      reasons.push('Animated edit: ' + label);
    if (audio && (c.voiceChanger && c.voiceChanger !== 'none' || c.noiseReduction)) reasons.push('Audio processing: ' + label);
    if (base) {
      if (c.rotation || c.flipH || c.flipV || c.scale !== 1 || c.posX || c.posY || c.opacity !== 1 ||
          c.maskShape !== 'none' || c.chromaKeyEnabled || c.bgRemovalEnabled || c.stabilizationEnabled ||
          c.filterPreset !== 'none' || c.blendMode !== 'source-over')
        reasons.push('Main-track transform/filter: ' + label);
      // Sharpen is currently unused in the canvas renderer; vignette is baked as an overlay below.
      if (Object.entries(c.adjustments).some(([k, v]) => !['vignette', 'sharpen', 'lutName'].includes(k) && typeof v === 'number' && v !== 0))
        reasons.push('Color adjustment: ' + label);
    }
    if (staticOverlay && (c.textAnimation && c.textAnimation !== 'none' || c.blendMode !== 'source-over' || c.chromaKeyEnabled))
      reasons.push('Animated/blended overlay: ' + label);
    if (c.startTime + c.duration > end + 0.02) reasons.push('Layer extends beyond main video: ' + label);
  }
  return [...new Set(reasons)];
}

function asBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
  });
}

export async function exportNative(project: ProjectData, cancel: CancelFlag, log: Diagnostic, progress: (n: number) => void) {
  if (!nativeExportAvailable()) throw new Error('NativeExporter plugin unavailable');
  const unsupported = nativeUnsupported(project);
  if (unsupported.length) throw new Error('Native fallback cannot preserve these edits: ' + unsupported.join('; '));
  const directory = 'clipnova-native-' + crypto.randomUUID();
  const staged: string[] = [];
  const paths = new Map<string, string>();
  let listener: PluginListenerHandle | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const stage = async (blob: Blob, name: string) => {
    const path = directory + '/' + name; staged.push(path);
    // Bound each bridge message; never base64 encode a full source file.
    for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
      abortIfCancelled(cancel);
      const data = await asBase64(blob.slice(offset, offset + 256 * 1024));
      if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
    if (!blob.size) throw new Error('Empty native source');
    return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  };
  try {
    const sources: Record<string, unknown>[] = [];
    for (const c of project.clips.filter(c => !c.muted && ['video', 'audio'].includes(c.trackType))) {
      abortIfCancelled(cancel);
      if (!c.mediaUrl) throw new Error('Missing source: ' + c.title);
      let path = paths.get(c.mediaUrl);
      if (!path) {
        const response = await fetch(c.mediaUrl);
        if (!response.ok) throw new Error('Cannot read native source: ' + response.status);
        path = await stage(await response.blob(), 'source-' + paths.size + (c.sourceType === 'uploaded-image' ? '.png' : '.media'));
        paths.set(c.mediaUrl, path);
      }
      sources.push({ path, track: c.trackType, start: c.startTime, duration: c.duration,
        sourceStart: c.sourceStart, sourceEnd: c.sourceStart + c.duration * c.speed,
        speed: c.speed, volume: c.volume / 100, fadeIn: c.fadeIn, fadeOut: c.fadeOut,
        image: c.sourceType === 'uploaded-image' });
    }
    const { width, height } = getAspectDimensions(project.aspectRatio, 'export-full', project.resolution);
    const overlays: { path: string; start: number; end: number }[] = [];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    await document.fonts.ready;
    const toBlob = () => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Overlay bitmap failed')), 'image/png'));
    const addOverlay = async (clip: TimelineClip) => {
      overlays.push({ path: await stage(await toBlob(), 'overlay-' + overlays.length + '.png'),
        start: clip.startTime, end: clip.startTime + clip.duration });
    };
    for (const c of project.clips.filter(c => c.trackType === 'video' && !c.muted && c.adjustments.vignette > 0)) {
      ctx.clearRect(0, 0, width, height);
      const gradient = ctx.createRadialGradient(width / 2, height / 2, width * .25, width / 2, height / 2, width * .72);
      gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, 'rgba(0,0,0,' + c.adjustments.vignette / 100 * .75 + ')');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); await addOverlay(c);
    }
    const order: Record<string, number> = { overlay: 1, sticker: 2, text: 3 };
    for (const c of project.clips.filter(c => ['text', 'sticker', 'overlay'].includes(c.trackType) && !c.muted)
      .sort((a, b) => order[a.trackType] - order[b.trackType])) {
      abortIfCancelled(cancel);
      const media = new Map<string, HTMLImageElement>();
      if (c.mediaUrl) { const image = new Image(); image.src = c.mediaUrl; await image.decode(); media.set(c.id, image); }
      renderProjectFrame(ctx, { ...project, background: { ...project.background, type: 'solid', solidColor: 'transparent' }, clips: [c] },
        c.startTime + c.duration / 2, media, 'export-full', true);
      await addOverlay(c);
    }
    listener = await NativeExporter.addListener('progress', e => progress(e.progress));
    timer = setInterval(() => { if (cancel.current) void NativeExporter.cancel(); }, 100);
    abortIfCancelled(cancel);
    const result = await NativeExporter.exportVideo({ plan: {
      sources, overlays, width, height, fps: project.fps,
      duration: Math.max(...project.clips.filter(c => c.trackType === 'video' && !c.muted).map(c => c.startTime + c.duration)),
      expectMotion: project.clips.some(c => c.sourceType === 'uploaded-video' && !c.muted),
      name: project.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + Date.now() + '.mp4',
    } });
    abortIfCancelled(cancel);
    if (!result.verified || result.size <= 0 || result.duration <= 0 || result.frames < 1) throw new Error('Native output was not verified');
    log('native-verified', JSON.stringify(result)); return result;
  } finally {
    if (timer) clearInterval(timer);
    await listener?.remove();
    for (const path of staged) { try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch {} }
    try { await Filesystem.rmdir({ path: directory, directory: Directory.Cache }); } catch {}
  }
}
