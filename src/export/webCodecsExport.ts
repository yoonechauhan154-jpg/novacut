import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { ExportOptions } from './exportEngine';
import { renderProjectAudio } from './exportEngine';
import { createExportMedia, advanceVideo, abortIfCancelled, clipSourceTime } from './exportMedia';
import { getAspectDimensions, renderProjectFrame } from '../utils/canvasRenderer';

export async function encodeWebCodecs(opts: ExportOptions, log: (step: string, detail: string) => void) {
  const { project, cancelRef } = opts;
  const duration = Math.max(0, ...project.clips.map(c => c.startTime + c.duration));
  if (!duration) throw new Error('Timeline is empty');
  if (duration > 180) throw new Error('WebView export memory limit (180s); trying native export');
  if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs VideoEncoder unavailable');
  const { width, height } = getAspectDimensions(project.aspectRatio, 'export-full', project.resolution);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Export canvas unavailable');
  const config: VideoEncoderConfig = {
    codec: 'avc1.420028', width, height, bitrate: Math.max(1000000, width * height * 3),
    framerate: project.fps, latencyMode: 'realtime', avc: { format: 'avc' },
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('H.264 encoder does not support the requested dimensions');
  const resources = await createExportMedia(project, cancelRef, log, true);
  let encoder: VideoEncoder | undefined;
  let audioEncoder: AudioEncoder | undefined;
  let encoderError: Error | undefined;
  const check = () => { abortIfCancelled(cancelRef); if (encoderError) throw encoderError; };
  const pause = () => new Promise(r => setTimeout(r, 4));
  try {
    // Probe/encode source audio before claiming the output contains audio.
    const audio = opts.safeMode ? { buffer: null, hasAudio: false } :
      await renderProjectAudio(project, resources.audio, resources.media, log);
    check();
    const hasAudio = audio.hasAudio && !!audio.buffer;
    const audioConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
    if (hasAudio && (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(audioConfig)).supported))
      throw new Error('AAC encoder unavailable; trying native export with audio');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target, video: { codec: 'avc', width, height, frameRate: project.fps },
      audio: hasAudio ? { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined,
      fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    });
    let chunks = 0;
    encoder = new VideoEncoder({
      // Decoder configuration (avcC) must reach the muxer along with the first chunk.
      output: (chunk, metadata) => { muxer.addVideoChunk(chunk, metadata); chunks++; },
      error: err => { encoderError = err; },
    });
    encoder.configure(config);
    const totalFrames = Math.ceil(duration * project.fps);
    const started = performance.now();
    for (let i = 0; i < totalFrames; i++) {
      check();
      const time = i / project.fps;
      await resources.prepare(time);
      for (const clip of project.clips) {
        if (time < clip.startTime || time >= clip.startTime + clip.duration || clip.muted) continue;
        const el = resources.media.get(clip.id);
        if (el instanceof HTMLVideoElement) await advanceVideo(el, clipSourceTime(clip, time, el.duration), project.fps, cancelRef, log);
      }
      check();
      // The compositor must not seek an element after the export decoder has prepared it.
      renderProjectFrame(ctx, project, time, resources.media, 'export-full', true);
      const slotDeadline = performance.now() + 10000;
      while (encoder.encodeQueueSize >= 3) {
        check(); if (performance.now() > slotDeadline) throw new Error('Video encoder queue stalled');
        await pause();
      }
      const timestamp = Math.round(i * 1000000 / project.fps);
      const frame = new VideoFrame(canvas, {
        timestamp, duration: Math.round((i + 1) * 1000000 / project.fps) - timestamp,
      });
      try { encoder.encode(frame, { keyFrame: i % (project.fps * 2) === 0 }); }
      finally { frame.close(); }
      const pct = Math.round((i + 1) * 90 / totalFrames);
      opts.onProgress(pct, i + 1, totalFrames, (performance.now() - started) / (i + 1) * (totalFrames - i - 1));
      if (i % 25 === 0) log('frame', i + '/' + totalFrames + ' chunks=' + chunks + ' queue=' + encoder.encodeQueueSize);
      // Allow cancel/UI messages to run even for all-procedural or still-image projects.
      await pause();
    }
    await encoder.flush(); check();
    if (hasAudio && audio.buffer) {
      audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
        error: err => { encoderError = err; },
      });
      audioEncoder.configure(audioConfig);
      // Bounded PCM chunks; don't allocate another entire interleaved audio copy.
      for (let offset = 0; offset < audio.buffer.length; offset += 1024) {
        check();
        const count = Math.min(1024, audio.buffer.length - offset);
        const data = new Float32Array(count * 2);
        for (let c = 0; c < 2; c++) data.set(audio.buffer.getChannelData(c).subarray(offset, offset + count), c * count);
        const packet = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 2,
          numberOfFrames: count, timestamp: Math.round(offset * 1000000 / 48000), data });
        try { audioEncoder.encode(packet); } finally { packet.close(); }
        const deadline = performance.now() + 10000;
        while (audioEncoder.encodeQueueSize >= 8) {
          check(); if (performance.now() > deadline) throw new Error('Audio encoder queue stalled');
          await pause();
        }
      }
      await audioEncoder.flush(); check();
    }
    muxer.finalize(); check();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    log('mux-done', 'frames=' + chunks + ' bytes=' + blob.size + ' audio=' + hasAudio);
    await opts.onResult({ format: 'MP4 (H.264 + AAC)', resolution: width + '×' + height, duration,
      frames: chunks, size: blob.size, hasAudio, blob, log: [] });
  } finally {
    try { encoder?.close(); } catch {}
    try { audioEncoder?.close(); } catch {}
    resources.dispose();
  }
}
