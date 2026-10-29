import type { ExportOptions } from './exportEngine';
import { renderProjectAudio } from './exportEngine';
import { createExportMedia, seekVideo, clipSourceTime, abortIfCancelled } from './exportMedia';
import { getAspectDimensions, renderProjectFrame } from '../utils/canvasRenderer';

/** Real-time browser fallback. The audio clock owns the timeline; draws never overlap. */
export async function encodeRecorder(opts: ExportOptions, log: (step: string, detail: string) => void) {
  const { project, cancelRef } = opts;
  const duration = Math.max(0, ...project.clips.map(c => c.startTime + c.duration));
  if (!duration || duration > 180) throw new Error('Browser recorder supports timelines up to 180 seconds');
  const resources = await createExportMedia(project, cancelRef, log, true);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, getAspectDimensions(project.aspectRatio, 'export-full', project.resolution));
  const ctx = canvas.getContext('2d')!;
  let stream: MediaStream | undefined, audioContext: AudioContext | undefined, recorder: MediaRecorder | undefined;
  let audioSource: AudioBufferSourceNode | undefined;
  try {
    const audio = opts.safeMode ? { buffer: null, hasAudio: false } :
      await renderProjectAudio(project, resources.audio, resources.media, log);
    abortIfCancelled(cancelRef);
    stream = canvas.captureStream(project.fps);
    if (audio.buffer && audio.hasAudio) {
      audioContext = new AudioContext({ sampleRate: 48000 });
      await audioContext.resume();
      const dest = audioContext.createMediaStreamDestination();
      audioSource = audioContext.createBufferSource(); audioSource.buffer = audio.buffer; audioSource.connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    }
    const types = opts.format === 'mp4' ?
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] :
      ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('No supported MediaRecorder format');
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error('MediaRecorder failed'));
    });
    // Attach rejection immediately, including if decoding fails before stop.
    void stopped.catch(() => {});
    const active = new Set<string>();
    const draw = async (time: number) => {
      await resources.prepare(time);
      for (const clip of project.clips) {
        const el = resources.media.get(clip.id);
        if (!(el instanceof HTMLVideoElement)) continue;
        if (time < clip.startTime || time >= clip.startTime + clip.duration || clip.muted) {
          el.pause(); active.delete(clip.id); continue;
        }
        const target = clipSourceTime(clip, time, el.duration);
        if (!active.has(clip.id) || Math.abs(el.currentTime - target) > 0.25 || clip.reversed || clip.frozen)
          await seekVideo(el, target, cancelRef, log);
        active.add(clip.id);
        if (!clip.frozen && !clip.reversed) { el.playbackRate = Math.max(0.0625, clip.speed); await el.play(); }
      }
      renderProjectFrame(ctx, project, time, resources.media, 'export-full', true);
    };
    await draw(0);
    recorder.start(250);
    const start = audioContext ? audioContext.currentTime : performance.now() / 1000;
    audioSource?.start();
    let frames = 0;
    while (true) {
      abortIfCancelled(cancelRef);
      const time = (audioContext ? audioContext.currentTime : performance.now() / 1000) - start;
      if (time >= duration) break;
      await draw(time); frames++;
      opts.onProgress(Math.round(time / duration * 90), frames, Math.ceil(duration * project.fps), (duration - time) * 1000);
      await new Promise(r => setTimeout(r, 1000 / project.fps));
    }
    recorder.stop(); await stopped; abortIfCancelled(cancelRef);
    const blob = new Blob(chunks, { type: mimeType.includes('mp4') ? 'video/mp4' : 'video/webm' });
    await opts.onResult({ format: mimeType.includes('mp4') ? 'MP4' : 'WebM', resolution: canvas.width + '×' + canvas.height,
      duration, frames, size: blob.size, hasAudio: audio.hasAudio, blob, log: [] });
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    try { audioSource?.stop(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    await audioContext?.close();
    resources.dispose();
  }
}
