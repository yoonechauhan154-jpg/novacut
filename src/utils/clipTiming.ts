import type { ProjectData, TimelineClip } from '../types/editor';
export const clipSpeed = (clip: Pick<TimelineClip, 'speed'>) => Math.max(.1, Math.min(10, Number(clip.speed) || 1));
/** Source in/out points are original seconds; duration is timeline seconds. */
export const sourceSpan = (clip: TimelineClip) => clip.sourceEnd > clip.sourceStart
  ? clip.sourceEnd - clip.sourceStart : clip.duration * clipSpeed(clip);
export function clipSourceTime(clip: TimelineClip, time: number, sourceDuration = Infinity) {
  const offset = Math.max(0, Math.min(clip.duration, time - clip.startTime)) * clipSpeed(clip);
  const end = clip.sourceStart + sourceSpan(clip);
  const source = clip.frozen ? clip.sourceStart : clip.reversed ? end - offset : clip.sourceStart + offset;
  return Math.max(0, Math.min(source, end - .001, sourceDuration - .001));
}
export function changeClipSpeed(project: ProjectData, id: string, value: number): ProjectData {
  const selected = project.clips.find(c => c.id === id);
  if (!selected) return project;
  const speed = clipSpeed({ speed: value }), span = sourceSpan(selected);
  const duration = span / speed, oldEnd = selected.startTime + selected.duration;
  const delta = duration - selected.duration;
  const ratio = duration / selected.duration;
  const mapTime = (t: number) => t <= selected.startTime ? t : t >= oldEnd ? t + delta : selected.startTime + (t - selected.startTime) * ratio;
  return { ...project, clips: project.clips.map(c => c.id === id
    ? { ...c, speed, speedCurve: 'normal', duration, sourceEnd: c.sourceStart + span, outPoint: c.inPoint + duration,
        keyframes: c.keyframes.map(k => ({ ...k, timeOffset: k.timeOffset * ratio })) }
    // Visual overlays follow the retimed interval. Independent media retain their own speed.
    : selected.trackType === 'video' && ['text', 'sticker', 'effect-layer', 'adjustment'].includes(c.trackType)
      ? { ...c, startTime: mapTime(c.startTime), duration: Math.max(.01, mapTime(c.startTime + c.duration) - mapTime(c.startTime)),
          keyframes: c.keyframes.map(k => ({ ...k, timeOffset: mapTime(c.startTime + k.timeOffset) - mapTime(c.startTime) })) }
    : c.startTime >= oldEnd - .000001 && (selected.trackType === 'video' || c.trackId === selected.trackId)
      ? { ...c, startTime: Math.max(0, c.startTime + delta) } : c) };
}
export function splitClip(clip: TimelineClip, offset: number, secondId: string): [TimelineClip, TimelineClip] {
  const speed = clipSpeed(clip), end = clip.sourceStart + sourceSpan(clip);
  const cut = clip.reversed ? end - offset * speed : clip.sourceStart + offset * speed;
  return [
    { ...clip, duration: offset, sourceStart: clip.reversed ? cut : clip.sourceStart,
      sourceEnd: clip.reversed ? end : cut, outPoint: clip.inPoint + offset },
    { ...clip, id: secondId, title: clip.title + ' (2)', startTime: clip.startTime + offset,
      duration: clip.duration - offset, sourceStart: clip.reversed ? clip.sourceStart : cut,
      sourceEnd: clip.reversed ? cut : end, inPoint: clip.inPoint + offset },
  ];
}
export function configurePreviewRate(el: HTMLMediaElement, clip: TimelineClip): boolean {
  el.preservesPitch = clip.keepPitch !== false;
  try { if (el.playbackRate !== clipSpeed(clip)) el.playbackRate = clipSpeed(clip); }
  catch { return false; }
  return !clip.reversed && !clip.frozen;
}

/** Migrate projects saved by the old slider, which changed speed but left duration unchanged. */
export function normalizeClipSpeeds(project: ProjectData) {
  for (const original of project.clips) {
    const clip = project.clips.find(c => c.id === original.id)!;
    if (['uploaded-video', 'uploaded-audio'].includes(clip.sourceType) && clip.speed !== 1
      && Math.abs(clip.duration - sourceSpan(clip) / clipSpeed(clip)) > .001)
      project = changeClipSpeed(project, clip.id, clip.speed);
  }
  return project;
}
