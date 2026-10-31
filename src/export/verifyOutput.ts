import { createOwnedMediaUrl, revokeOwnedMediaUrl } from '../utils/mediaOwnership';
import { attachExportVideo, loadVideo, seekVideo, type CancelFlag, type Diagnostic } from './exportMedia';

export interface FileVerification {
  ok: boolean; duration: number; frames: number; hasAudio: boolean; framesChanging: boolean; error: string | null;
}
const typeAt = (v: DataView, p: number) => String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + p, 4));

/** Inspect the actual MP4 sample table, never infer audio from byte count or requested options.
 * Skip mdat using Blob.slice so source/output media need not be copied into JavaScript memory.
 */
export async function inspectMp4(blob: Blob) {
  let moov: ArrayBuffer | undefined;
  for (let p = 0; p + 8 <= blob.size;) {
    const h = new DataView(await blob.slice(p, p + 16).arrayBuffer());
    let size = h.getUint32(0), header = 8;
    if (size === 1) { size = Number(h.getBigUint64(8)); header = 16; }
    if (size === 0) size = blob.size - p;
    if (size < header || p + size > blob.size) throw new Error('Invalid MP4 box size');
    if (typeAt(h, 4) === 'moov') {
      if (size > 64 * 1024 * 1024) throw new Error('MP4 metadata exceeds verification limit');
      moov = await blob.slice(p + header, p + size).arrayBuffer(); break;
    }
    p += size;
  }
  if (!moov) throw new Error('MP4 has no movie metadata');
  const v = new DataView(moov);
  const tracks: { handler: string; duration: number; samples: number }[] = [];
  const walk = (start: number, end: number, track?: typeof tracks[number]) => {
    for (let p = start; p + 8 <= end;) {
      const size = v.getUint32(p), type = typeAt(v, p + 4), d = p + 8;
      if (size < 8 || p + size > end) throw new Error('Invalid MP4 metadata');
      if (type === 'trak') {
        const t = { handler: '', duration: 0, samples: 0 }; tracks.push(t); walk(d, p + size, t);
      } else if (['mdia', 'minf', 'stbl'].includes(type)) walk(d, p + size, track);
      else if (track && type === 'hdlr') track.handler = typeAt(v, d + 8);
      else if (track && type === 'mdhd') {
        const version = v.getUint8(d), scale = v.getUint32(d + (version ? 20 : 12));
        const duration = version ? Number(v.getBigUint64(d + 24)) : v.getUint32(d + 16);
        track.duration = duration / scale;
      } else if (track && type === 'stsz') track.samples = v.getUint32(d + 8);
      p += size;
    }
  };
  walk(0, v.byteLength);
  const video = tracks.find(t => t.handler === 'vide');
  if (!video || !video.samples || !Number.isFinite(video.duration)) throw new Error('MP4 contains no video samples');
  return { duration: video.duration, frames: video.samples, hasAudio: tracks.some(t => t.handler === 'soun' && t.samples > 0) };
}

export async function verifyOutput(blob: Blob, expectedDuration: number, expectAudio: boolean,
  expectMotion: boolean, cancel: CancelFlag, log: Diagnostic): Promise<FileVerification> {
  const result: FileVerification = { ok: false, duration: 0, frames: 0, hasAudio: false, framesChanging: false, error: null };
  const url = createOwnedMediaUrl(blob, 'verifyOutput'), video = attachExportVideo('output-verification');
  try {
    if (!blob.size) throw new Error('Output is empty');
    if (blob.type.includes('mp4')) Object.assign(result, await inspectMp4(blob));
    await loadVideo(video, url, cancel, log);
    if (!Number.isFinite(video.duration)) {
      // MediaRecorder WebM has no duration header until its last cluster is read.
      await seekVideo(video, 1e10, cancel, log);
    }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Output duration could not be read');
    result.duration = duration;
    if (Math.abs(duration - expectedDuration) > Math.max(0.35, expectedDuration * 0.03))
      throw new Error('Output duration does not match the timeline: ' + duration + ' / ' + expectedDuration);
    if (!blob.type.includes('mp4')) {
      // Decode the real audio stream. Missing/unsupported audio is not reported as present.
      const audio = new AudioContext();
      try {
        if (blob.size > 128 * 1024 * 1024) throw new Error('WebM audio verification limit; use MP4');
        const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
        result.hasAudio = decoded.numberOfChannels > 0 && decoded.length > 0;
      } catch (err) { if (expectAudio) throw err; }
      finally { await audio.close(); }
    }
    if (expectAudio && !result.hasAudio) throw new Error('Expected audio stream is missing');
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Verification canvas unavailable');
    let previous: Uint8ClampedArray | undefined;
    for (const fraction of [0.05, 0.23, 0.41, 0.59, 0.77, 0.95]) {
      await seekVideo(video, duration * fraction, cancel, log);
      ctx.drawImage(video, 0, 0, 32, 32);
      // Six small verification samples only; no pixel readback in the render loop.
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      if (previous) {
        let difference = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          difference += Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i + 1] - previous[i + 1]) + Math.abs(pixels[i + 2] - previous[i + 2]);
        }
        if (difference / (32 * 32 * 3) > 1.5) result.framesChanging = true;
      }
      previous = pixels;
    }
    if (expectMotion && !result.framesChanging) throw new Error('Frames are not changing in six output samples');
    result.ok = true; log('verify', JSON.stringify(result));
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err); log('verify-failed', JSON.stringify(result));
  } finally {
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); revokeOwnedMediaUrl(url, 'verifyOutput');
  }
  return result;
}
