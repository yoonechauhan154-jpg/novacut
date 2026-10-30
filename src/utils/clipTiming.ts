import type { ProjectData, TimelineClip } from '../types/editor';
export const clipSpeed = (clip: Pick<TimelineClip, 'speed'>) => Math.max(.1, Math.min(10, Number(clip.speed) || 1));
/** Source in/out points are original seconds; duration is timeline seconds. */
export function clipSourceTime(clip: TimelineClip, time: number, sourceDuration = Infinity) {
  const offset = Math.max(0, Math.min(clip.duration, time - clip.startTime)) * clipSpeed(clip);
  const end = clip.sourceStart + clip.duration * clipSpeed(clip);
  const source = clip.frozen ? clip.sourceStart : clip.reversed ? end - offset : clip.sourceStart + offset;
  return Math.max(0, Math.min(source, end - .001, sourceDuration - .001));
}
export function changeClipSpeed(project: ProjectData, id: string, value: number): ProjectData {
  const selected = project.clips.find(c => c.id === id);
  if (!selected) return project;
  const speed = clipSpeed({ speed: value }), span = selected.duration * clipSpeed(selected);
  const duration = span / speed, oldEnd = selected.startTime + selected.duration;
  const delta = duration - selected.duration;
  return { ...project, clips: project.clips.map(c => c.id === id
    ? { ...c, speed, speedCurve: 'normal', duration, sourceEnd: c.sourceStart + span, outPoint: c.inPoint + duration }
    // Main-track ripple moves later items on every track, preserving relative alignment.
    // Independent audio/PIP edits ripple their own track; overlapping layers retain timing.
    : c.startTime >= oldEnd - .000001 && (selected.trackType === 'video' || c.trackId === selected.trackId)
      ? { ...c, startTime: Math.max(0, c.startTime + delta) } : c) };
}
export function splitClip(clip: TimelineClip, offset: number, secondId: string): [TimelineClip, TimelineClip] {
  const speed = clipSpeed(clip), end = clip.sourceStart + clip.duration * speed;
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
