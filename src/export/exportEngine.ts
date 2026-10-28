import { ProjectData, TimelineClip } from '../types/editor';
import { renderProjectFrame, getAspectDimensions } from '../utils/canvasRenderer';
import { saveAndShareFileOnDevice } from '../utils/androidBridge';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ExportLogEntry {
  step: string;
  detail: string;
  ts: number;
}

export interface ExportOptions {
  project: ProjectData;
  canvas: HTMLCanvasElement;
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>;
  audioElementsRef: Map<string, HTMLAudioElement>;
  format: 'mp4' | 'webm';
  onProgress: (pct: number, framesDone: number, totalFrames: number, estMsLeft: number) => void;
  onResult: (result: {
    format: string;
    resolution: string;
    duration: number;
    frames: number;
    size: number;
    hasAudio: boolean;
    blob: Blob;
    log: ExportLogEntry[];
  }) => void;
  onError: (msg: string) => void;
  cancelRef: { current: boolean };
}

export interface WebCodecsSupport {
  available: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  reason: string | null;
}

/* ------------------------------------------------------------------ */
/*  Logging                                                           */
/* ------------------------------------------------------------------ */

let exportLog: ExportLogEntry[] = [];

function logExport(step: string, detail: string) {
  const entry: ExportLogEntry = { step, detail, ts: Date.now() };
  exportLog.push(entry);
  console.log(`[EXPORT][${step}] ${detail}`);
}

export function getExportLog(): ExportLogEntry[] {
  return [...exportLog];
}

export function clearExportLog() {
  exportLog = [];
}

/* ------------------------------------------------------------------ */
/*  WebCodecs capability probing                                      */
/* ------------------------------------------------------------------ */

export async function probeWebCodecsSupport(): Promise<WebCodecsSupport> {
  const result: WebCodecsSupport = {
    available: false,
    videoCodec: null,
    audioCodec: null,
    reason: null,
  };

  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    result.reason = 'VideoEncoder/AudioEncoder not available in this WebView';
    return result;
  }

  // Probe video codecs (prefer AVC/H.264 for hardware acceleration on Android)
  const videoCandidates = [
    'avc1.42E028', // H.264 Main L3.1 - 720p/1080p@30, widely hardware-accelerated
    'avc1.42E01E', // H.264 Main L3.0
    'avc1.640028', // H.264 High L3.1
    'vp9', // VP9 fallback
  ];
  let chosenVideo = null;
  for (const codec of videoCandidates) {
    try {
      const supported = await VideoEncoder.isConfigSupported({
        codec,
        width: 1920,
        height: 1080,
        bitrate: 6_000_000,
        framerate: 30,
      });
      if (supported.supported) {
        chosenVideo = codec;
        break;
      }
    } catch {
      // continue
    }
  }

  // Probe audio codecs
  const audioCandidates = ['mp4a.40.2', 'opus'];
  let chosenAudio = null;
  for (const codec of audioCandidates) {
    try {
      const supported = await AudioEncoder.isConfigSupported({
        codec,
        numberOfChannels: 2,
        sampleRate: 48000,
        bitrate: 128_000,
      });
      if (supported.supported) {
        chosenAudio = codec;
        break;
      }
    } catch {
      // continue
    }
  }

  result.available = !!chosenVideo && !!chosenAudio;
  result.videoCodec = chosenVideo;
  result.audioCodec = chosenAudio;

  if (!chosenVideo) {
    result.reason = 'No supported video codec found';
  } else if (!chosenAudio) {
    result.reason = 'No supported audio codec found';
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Resolution check with fallback                                    */
/* ------------------------------------------------------------------ */

export async function checkResolutionSupported(
  width: number,
  height: number,
  fps: number,
  codec: string
): Promise<{ supported: boolean; fallbackWidth?: number; fallbackHeight?: number }> {
  if (typeof VideoEncoder === 'undefined') {
    return { supported: false };
  }
  try {
    const supported = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: width * height * 0.15,
      framerate: fps,
    });
    if (supported.supported) return { supported: true };
  } catch {
    // not supported
  }

  const aspect = width / height;
  const fallbackHeight = 720;
  const fallbackWidth = Math.round(fallbackHeight * aspect / 2) * 2;
  try {
    const supported = await VideoEncoder.isConfigSupported({
      codec,
      width: fallbackWidth,
      height: fallbackHeight,
      bitrate: fallbackWidth * fallbackHeight * 0.15,
      framerate: fps,
    });
    if (supported.supported) {
      return { supported: false, fallbackWidth, fallbackHeight };
    }
  } catch {
    // 720p also not supported
  }
  return { supported: false };
}

/* ------------------------------------------------------------------ */
/*  Frame seek helper                                                 */
/* ------------------------------------------------------------------ */

/**
 * Seek a video element to a target time.
 * Sets currentTime synchronously and returns immediately without waiting for seeked.
 * The browser decodes the nearest frame on the next RAF.
 * Returns true if the element is ready (readyState >= 2), false otherwise.
 */
async function seekToFrame(
  el: HTMLVideoElement,
  targetTime: number,
  timeoutMs: number = 3000
): Promise<boolean> {
  if (el.readyState < 2) return false;
  const prevTime = el.currentTime;
  el.currentTime = targetTime;
  // currentTime assignment is synchronous; if it changed, seek was initiated
  return Math.abs(el.currentTime - prevTime) > 0.001 || el.currentTime === targetTime;
}

/* ------------------------------------------------------------------ */
/*  Offline audio rendering + AAC encoding                            */
/* ------------------------------------------------------------------ */

/**
 * Fetch an ArrayBuffer from a media URL (blob URL or http).
 */
async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.arrayBuffer();
}

/**
 * Decode audio from a media element's source into an AudioBuffer.
 */
async function decodeAudioFromElement(
  audioCtx: BaseAudioContext,
  el: HTMLMediaElement
): Promise<AudioBuffer | null> {
  try {
    const src = el.src;
    if (!src) return null;
    const ab = await fetchArrayBuffer(src);
    return await audioCtx.decodeAudioData(ab);
  } catch (err) {
    console.warn('[EXPORT] decodeAudioFromElement failed:', err);
    return null;
  }
}

/**
 * Convert an AudioBuffer (planar Float32) to interleaved Int16 PCM chunks
 * suitable for feeding into AudioEncoder as EncodedAudioChunk input.
 */
function audioBufferToPcmChunks(
  buffer: AudioBuffer,
  samplesPerChunk: number = 1024
): { data: Int16Array; timestampUs: number }[] {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;

  // Interleave channels into Float32
  const interleaved = new Float32Array(length * numChannels);
  for (let c = 0; c < numChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      interleaved[i * numChannels + c] = ch[i];
    }
  }

  const chunks: { data: Int16Array; timestampUs: number }[] = [];
  const samplesPerChunkPerChannel = samplesPerChunk;
  const bytesPerChunk = samplesPerChunkPerChannel * numChannels * 2; // Int16

  let totalSamplesWritten = 0;
  let timestampUs = 0;

  for (let offset = 0; offset < interleaved.length; offset += samplesPerChunkPerChannel * numChannels) {
    const end = Math.min(offset + samplesPerChunkPerChannel * numChannels, interleaved.length);
    const pcm = new Int16Array(end - offset);
    for (let i = offset; i < end; i++) {
      pcm[i - offset] = Math.max(-32768, Math.min(32767, Math.round(interleaved[i] * 32767)));
    }
    chunks.push({ data: pcm, timestampUs });
    totalSamplesWritten += pcm.length / numChannels;
    timestampUs = Math.round((totalSamplesWritten / sampleRate) * 1_000_000);
  }

  return chunks;
}

/**
 * Render the full project audio offline: decode all video/audio sources,
 * apply start/end/speed/volume/fades, mix in OfflineAudioContext.
 */
async function renderProjectAudio(
  project: ProjectData,
  audioElementsRef: Map<string, HTMLAudioElement>,
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  onLog: (step: string, detail: string) => void
): Promise<{ buffer: AudioBuffer | null; hasAudio: boolean }> {
  const sampleRate = 48000;
  const duration = Math.max(3, ...project.clips.map((c) => c.startTime + c.duration));
  const offline = new OfflineAudioContext(2, duration * sampleRate, sampleRate);
  let hasAnyAudio = false;

  for (const clip of project.clips) {
    if (clip.trackType !== 'audio' && clip.trackType !== 'video') continue;
    if (clip.muted) continue;

    let buffer: AudioBuffer | null = null;
    let el: HTMLMediaElement | null = null;

    if (clip.trackType === 'audio') {
      el = audioElementsRef.get(clip.id) || null;
    } else {
      const cached = mediaElementCache.get(clip.id);
      el = cached instanceof HTMLMediaElement ? cached : null;
    }

    if (el && el.src) {
      buffer = await decodeAudioFromElement(offline, el);
    }

    if (!buffer) continue;
    hasAnyAudio = true;

    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clip.speed || 1;

    const gain = offline.createGain();
    const vol = Math.max(0, Math.min(2, (clip.volume || 100) / 100));
    gain.gain.value = vol;

    if (clip.fadeIn && clip.fadeIn > 0) {
      gain.gain.setValueAtTime(0, offline.currentTime);
      gain.gain.linearRampToValueAtTime(vol, offline.currentTime + clip.fadeIn);
    }
    if (clip.fadeOut && clip.fadeOut > 0) {
      const endTime = clip.startTime + clip.duration;
      gain.gain.setValueAtTime(vol, endTime - clip.fadeOut);
      gain.gain.linearRampToValueAtTime(0, endTime);
    }

    source.connect(gain);
    gain.connect(offline.destination);

    const startOffset = Math.max(0, clip.sourceStart || 0);
    source.start(clip.startTime, startOffset, clip.duration);
  }

  onLog('audio-render', `Started offline audio render (${duration.toFixed(2)}s, ${sampleRate}Hz)`);
  const rendered = await offline.startRendering();
  onLog('audio-render', `Offline audio render complete, ${rendered.length} frames, hasAudio=${hasAnyAudio}`);

  return { buffer: rendered, hasAudio: hasAnyAudio };
}

/* ------------------------------------------------------------------ */
/*  Main WebCodecs export                                             */
/* ------------------------------------------------------------------ */

export async function startWebCodecsExport(opts: ExportOptions): Promise<void> {
  const {
    project,
    canvas,
    mediaElementCache,
    audioElementsRef,
    format,
    onProgress,
    onResult,
    onError,
    cancelRef,
  } = opts;

  clearExportLog();
  const log = (step: string, detail: string) => logExport(step, detail);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    onError('Cannot get 2D context on export canvas');
    return;
  }

  // --- Determine resolution ---
  const { width: expW, height: expH } = getAspectDimensions(
    project.aspectRatio,
    'export-full',
    project.resolution
  );
  const fps = project.fps;
  const totalDuration = Math.max(
    3,
    ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2)))
  );
  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDurationMs = 1000 / fps;

  log('init', `Export ${format.toUpperCase()} ${expW}x${expH} @ ${fps}fps, ${totalDuration}s, ${totalFrames} frames`);

  // --- Probe WebCodecs support ---
  const support = await probeWebCodecsSupport();
  log('probe', `WebCodecs available=${support.available} video=${support.videoCodec} audio=${support.audioCodec}`);

  if (!support.available || !support.videoCodec) {
    onError(
      `WebCodecs not available on this device: ${support.reason || 'unknown reason'}. ` +
        'MP4 export requires a WebView with WebCodecs support (Chrome 94+/Android 12+).'
    );
    return;
  }

  // --- Resolution fallback check ---
  let actualW = expW;
  let actualH = expH;
  const resCheck = await checkResolutionSupported(expW, expH, fps, support.videoCodec);
  log('resolution', `Requested ${expW}x${expH} supported=${resCheck.supported}`);
  if (!resCheck.supported && resCheck.fallbackWidth) {
    log('resolution-fallback', `Falling back to ${resCheck.fallbackWidth}x${resCheck.fallbackHeight}`);
    actualW = resCheck.fallbackWidth;
    actualH = resCheck.fallbackHeight ?? 720;
    canvas.width = actualW;
    canvas.height = actualH;
    log('resolution', `Canvas resized to ${actualW}x${actualH}`);
  } else {
    canvas.width = expW;
    canvas.height = expH;
  }

  // --- Set up VideoEncoder ---
  const videoBitrate = Math.round(actualW * actualH * 0.12);
  const videoChunks: EncodedVideoChunk[] = [];
  let videoChunkCount = 0;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      videoChunks.push(chunk);
      videoChunkCount++;
    },
    error: (e) => {
      log('encoder-error', e.message);
      onError(`VideoEncoder error: ${e.message}`);
    },
  });

  videoEncoder.configure({
    codec: support.videoCodec,
    width: actualW,
    height: actualH,
    bitrate: videoBitrate,
    framerate: fps,
  });
  log('encoder-config', JSON.stringify({ codec: support.videoCodec, width: actualW, height: actualH, bitrate: videoBitrate, framerate: fps }));

  // --- Set up AudioEncoder ---
  const audioChunks: EncodedAudioChunk[] = [];
  let audioChunkCount = 0;
  let hasAudio = false;
  let audioCodec = support.audioCodec;

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      audioChunks.push(chunk);
      audioChunkCount++;
    },
    error: (e) => {
      log('audio-encoder-error', e.message);
      // Non-fatal: continue without audio
      hasAudio = false;
    },
  });

  audioEncoder.configure({
    codec: audioCodec!,
    numberOfChannels: 2,
    sampleRate: 48000,
    bitrate: 128_000,
  });
  log('audio-encoder-config', JSON.stringify({ codec: audioCodec, channels: 2, sampleRate: 48000, bitrate: 128000 }));

  // --- Render audio offline ---
  let audioBuffer: AudioBuffer | null = null;
  try {
    const audioResult = await renderProjectAudio(
      project,
      audioElementsRef,
      mediaElementCache,
      log
    );
    audioBuffer = audioResult.buffer;
    hasAudio = audioResult.hasAudio && !!audioBuffer;
  } catch (err) {
    log('audio-render-error', err instanceof Error ? err.message : String(err));
    hasAudio = false;
  }

  // --- Feed PCM chunks to AudioEncoder ---
  if (hasAudio && audioBuffer) {
    const pcmChunks = audioBufferToPcmChunks(audioBuffer, 1024);
    log('audio-pcm', `Prepared ${pcmChunks.length} PCM chunks for AudioEncoder`);
    for (const pcm of pcmChunks) {
      if (cancelRef.current) break;
      try {
        const audioData = new AudioData({
          data: pcm.data.buffer as unknown as ArrayBuffer,
          format: 's16',
          numberOfChannels: 2,
          numberOfFrames: pcm.data.length / 2,
          sampleRate: 48000,
          timestamp: pcm.timestampUs,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      } catch (err) {
        log('audio-encode-error', err instanceof Error ? err.message : String(err));
        hasAudio = false;
        break;
      }
    }
    await audioEncoder.flush();
  }

  // --- Frame-by-frame video rendering ---
  log('video-start', `Starting frame-by-frame video encoding: ${totalFrames} frames`);

  const startTime = performance.now();
  let framesEncoded = 0;
  let seeks = 0;
  let seekFailures = 0;

  function getClipVideoElement(clip: TimelineClip): HTMLVideoElement | null {
    if (clip.trackType !== 'video' && clip.trackType !== 'overlay') return null;
    if (clip.sourceType !== 'uploaded-video') return null;
    const cached = mediaElementCache.get(clip.id);
    return cached instanceof HTMLVideoElement ? cached : null;
  }

  async function encodeFrame(frameIdx: number): Promise<boolean> {
    if (cancelRef.current) return false;

    const t = frameIdx / fps;

    // Seek all active video elements to their source times
    const videoClips = project.clips.filter(
      (c) =>
        (c.trackType === 'video' || c.trackType === 'overlay') &&
        c.sourceType === 'uploaded-video' &&
        c.mediaUrl &&
        t >= c.startTime &&
        t <= c.startTime + c.duration
    );

    const seekPromises: Promise<boolean>[] = [];
    let frameSeekFailed = false;
    for (const clip of videoClips) {
      const el = getClipVideoElement(clip);
      if (!el) continue;

      const relTime = t - clip.startTime;
      const sourceTime =
        (clip.sourceStart + relTime * clip.speed) % Math.max(0.5, el.duration || clip.duration);

      if (Math.abs(el.currentTime - sourceTime) > 0.05) {
        seeks++;
        seekPromises.push(
          seekToFrame(el, sourceTime).then((ok) => {
            if (!ok) frameSeekFailed = true;
            return ok;
          })
        );
      }
    }

    await Promise.all(seekPromises);

    if (frameSeekFailed) return false;

    if (cancelRef.current) return false;

    // Brief delay for the browser to decode the seeked frame.
    // Use setTimeout instead of requestAnimationFrame for reliability in headless mode.
    await new Promise((r) => setTimeout(r, 16));

    // Draw the frame to canvas
    renderProjectFrame(ctx!, project, t, mediaElementCache, 'export-full', false);

    // Create VideoFrame and encode
    const videoFrame = new VideoFrame(canvas, { timestamp: frameIdx * frameDurationMs });
    videoEncoder.encode(videoFrame);
    videoFrame.close();

    framesEncoded++;
    const elapsedMs = performance.now() - startTime;
    const estMsLeft = (elapsedMs / Math.max(1, framesEncoded)) * (totalFrames - framesEncoded);
    const pct = Math.round((framesEncoded / totalFrames) * 100);
    onProgress(pct, framesEncoded, totalFrames, estMsLeft);

    return true;
  }

  // Encode all frames sequentially
  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current) {
      log('cancel', `Cancelled at frame ${i}/${totalFrames}`);
      try { videoEncoder.close(); } catch {}
      try { audioEncoder.close(); } catch {}
      return;
    }
    const ok = await encodeFrame(i);
    if (!ok && !cancelRef.current) {
      seekFailures++;
      if (seekFailures > 3) {
        onError(`Too many seek failures (${seekFailures}). Aborting to prevent frozen output.`);
        try { videoEncoder.close(); } catch {}
        try { audioEncoder.close(); } catch {}
        return;
      }
    }
  }

  log('video-done', `Encoded ${framesEncoded}/${totalFrames} frames, ${videoChunkCount} chunks, ${seeks} seeks, ${seekFailures} failures`);

  // Flush video encoder
  await videoEncoder.flush();
  videoEncoder.close();

  // --- Mux with mp4-muxer ---
  let Muxer: any;
  let ArrayBufferTarget: any;
  try {
    const mod = await import('mp4-muxer');
    Muxer = mod.Muxer;
    ArrayBufferTarget = mod.ArrayBufferTarget;
  } catch (err) {
    onError(`Failed to load mp4-muxer: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  log('mux-start', `Muxing ${videoChunks.length} video chunks, ${audioChunks.length} audio chunks`);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: actualW,
      height: actualH,
      frameRate: fps,
    },
    audio: hasAudio
      ? {
          codec: audioCodec === 'mp4a.40.2' ? 'aac' : 'opus',
          numberOfChannels: 2,
          sampleRate: 48000,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  // Add video chunks
  for (const chunk of videoChunks) {
    if (cancelRef.current) break;
    muxer.addVideoChunk(chunk);
  }

  // Add audio chunks
  for (const chunk of audioChunks) {
    if (cancelRef.current) break;
    muxer.addAudioChunk(chunk);
  }

  if (cancelRef.current) {
    log('cancel', 'Cancelled during mux');
    return;
  }

  muxer.finalize();
  const muxedBuffer = target.buffer;

  log('mux-done', `Muxed ${muxedBuffer.byteLength} bytes`);

  const blob = new Blob([muxedBuffer], { type: 'video/mp4' });

  log('result', `Produced ${blob.size} bytes, ${framesEncoded} frames, audio=${hasAudio}, audioChunks=${audioChunkCount}`);

  onResult({
    format: 'MP4 (H.264 + AAC)',
    resolution: project.resolution,
    duration: totalDuration,
    frames: framesEncoded,
    size: blob.size,
    hasAudio: hasAudio && audioChunkCount > 0,
    blob,
    log: getExportLog(),
  });
}

/* ------------------------------------------------------------------ */
/*  MediaRecorder fallback (deterministic frame-by-frame)             */
/* ------------------------------------------------------------------ */

export async function startMediaRecorderFallbackExport(opts: {
  project: ProjectData;
  canvas: HTMLCanvasElement;
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>;
  audioElementsRef: Map<string, HTMLAudioElement>;
  format: 'mp4' | 'webm';
  onProgress: (pct: number) => void;
  onResult: (result: { format: string; resolution: string; duration: number; frames: number; size: number; hasAudio: boolean; blob: Blob }) => void;
  onError: (msg: string) => void;
  cancelRef: { current: boolean };
}): Promise<void> {
  const { project, canvas, mediaElementCache, audioElementsRef, format, onProgress, onResult, onError, cancelRef } = opts;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    onError('Cannot get canvas context');
    return;
  }

  const { width: expW, height: expH } = getAspectDimensions(project.aspectRatio, 'export-full', project.resolution);
  const fps = project.fps;
  const totalDuration = Math.max(3, ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2))));
  const totalFrames = Math.ceil(totalDuration * fps);

  canvas.width = expW;
  canvas.height = expH;

  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

  // Add audio tracks
  mediaElementCache.forEach((el) => {
    if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
      try {
        const s = (el as any).captureStream();
        s.getAudioTracks().forEach((t: MediaStreamTrack) => combinedStream.addTrack(t));
      } catch {}
    }
  });
  audioElementsRef.forEach((el) => {
    try {
      const s = (el as any).captureStream();
      s.getAudioTracks().forEach((t: MediaStreamTrack) => combinedStream.addTrack(t));
    } catch {}
  });

  let mimeType = 'video/webm';
  if (format === 'mp4') {
    const cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9'];
    for (const c of cands) {
      if (MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }
  }

  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: Blob[] = [];
  let frameCount = 0;

  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = () => {
    const isMp4 = mimeType.includes('mp4');
    const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
    const audioTracks = combinedStream.getAudioTracks();
    onResult({
      format: isMp4 ? 'MP4 (H.264 + AAC)' : 'WebM (VP9)',
      resolution: project.resolution,
      duration: totalDuration,
      frames: frameCount,
      size: blob.size,
      hasAudio: audioTracks.length > 0,
      blob,
    });
  };

  recorder.start(1000);

  const startTime = performance.now();
  let frameInterval: ReturnType<typeof setInterval> | null = null;
  let finishTimeout: ReturnType<typeof setTimeout> | null = null;
  const frameDurationMs = 1000 / fps;
  // Abort the export when the media element stops seeking (frozen output).
  // Never silently emit a still photo as a video.
  let consecutiveStalls = 0;
  const MAX_STALLS = 3;
  let exportAborted = false;

  function abortExport(msg: string) {
    if (exportAborted) return;
    exportAborted = true;
    if (frameInterval) { clearInterval(frameInterval); frameInterval = null; }
    if (finishTimeout) { clearTimeout(finishTimeout); finishTimeout = null; }
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
    onError(msg);
  }

  async function drawNextFrame() {
    if (cancelRef.current) {
      if (frameInterval) clearInterval(frameInterval);
      recorder.stop();
      return;
    }
    const t = frameCount / fps;

    // Seek the active video source to this frame's time, exactly like the
    // WebCodecs path does. renderProjectFrame skips its own re-seek when the
    // element is already at the target (diff < 0.28).
    const activeClip = project.clips.find(
      (c) =>
        (c.trackType === 'video' || c.trackType === 'overlay') &&
        c.sourceType === 'uploaded-video' &&
        c.mediaUrl &&
        t >= c.startTime &&
        t <= c.startTime + c.duration
    );
    let sourceTime = 0;
    if (activeClip) {
      const el = mediaElementCache.get(activeClip.id);
      if (el instanceof HTMLVideoElement) {
        sourceTime =
          (activeClip.sourceStart + (t - activeClip.startTime) * activeClip.speed) %
          Math.max(0.5, el.duration || activeClip.duration);
        el.currentTime = Math.max(0, sourceTime);
      }
    }

    renderProjectFrame(ctx!, project, t, mediaElementCache, 'export-full', false);

    // Stall detection: if the element is not ready or refused to seek, the
    // canvas would repeat the same frame — abort before producing a photo.
    let stalled = false;
    if (activeClip) {
      const el = mediaElementCache.get(activeClip.id);
      if (!(el instanceof HTMLVideoElement) || el.readyState < 2) {
        stalled = true;
      } else {
        const check =
          (activeClip.sourceStart + (t - activeClip.startTime) * activeClip.speed) %
          Math.max(0.5, el.duration || activeClip.duration);
        if (Math.abs(el.currentTime - check) > 0.1) stalled = true;
      }
    }
    if (stalled) {
      consecutiveStalls++;
      if (consecutiveStalls > MAX_STALLS) {
        abortExport('Export failed: video element stalled — frames are not changing');
        return;
      }
    } else {
      consecutiveStalls = 0;
    }

    frameCount++;
    const pct = Math.round((frameCount / totalFrames) * 100);
    const elapsed = (performance.now() - startTime) / 1000;
    onProgress(pct);

    if (frameCount >= totalFrames) {
      if (frameInterval) clearInterval(frameInterval);
      recorder.stop();
    }
  }

  frameInterval = setInterval(() => {
    drawNextFrame().catch(() => {});
  }, frameDurationMs);

  finishTimeout = setTimeout(() => {
    if (frameInterval) clearInterval(frameInterval);
    if (!exportAborted && recorder.state !== 'inactive') recorder.stop();
  }, totalDuration * 1000 + 2000);
}

/* ------------------------------------------------------------------ */
/*  Legacy exports retained from original exportEngine.ts             */
/* ------------------------------------------------------------------ */

import { ColorAdjustments, ImportedMediaItem } from '../types/editor';

export function parseCubeLutFile(
  content: string,
  fileName: string
): { lutName: string; adjustmentsPatch: Partial<ColorAdjustments> } {
  const cleanName = fileName.replace(/\.[^/.]+$/i, '') || 'Custom LUT';
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('TITLE') && !l.startsWith('LUT_'));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (const line of lines.slice(0, 120)) {
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      rSum += parts[0];
      gSum += parts[1];
      bSum += parts[2];
      count++;
    }
  }

  if (count === 0) {
    return {
      lutName: cleanName,
      adjustmentsPatch: {
        lutName: cleanName,
        contrast: 14,
        saturation: 18,
        temperature: 16,
      },
    };
  }

  const rAvg = rSum / count;
  const bAvg = bSum / count;
  const warmth = Math.round((rAvg - bAvg) * 65);

  return {
    lutName: cleanName,
    adjustmentsPatch: {
      lutName: cleanName,
      contrast: 12,
      saturation: 15,
      temperature: Math.max(-40, Math.min(40, warmth)),
    },
  };
}

export async function downloadProjectJson(project: ProjectData) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const fileName = `${project.name.replace(/\s+/g, '_')}_ClipNova.json`;
  return saveAndShareFileOnDevice(blob, fileName, 'ClipNova Project Archive');
}

function formatSrtTime(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export async function downloadSrtSubtitles(project: ProjectData) {
  const textClips = project.clips
    .filter((c) => c.trackType === 'text' && c.textContent)
    .sort((a, b) => a.startTime - b.startTime);

  const srtContent =
    textClips.length === 0
      ? '1\n00:00:00,000 --> 00:00:03,000\nClipNova Studio Subtitles\n'
      : textClips
          .map(
            (c, i) =>
              `${i + 1}\n${formatSrtTime(c.startTime)} --> ${formatSrtTime(
                c.startTime + c.duration
              )}\n${c.textContent}\n`
          )
          .join('\n');

  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const fileName = `${project.name.replace(/\s+/g, '_')}_Captions.srt`;
  return saveAndShareFileOnDevice(blob, fileName, 'ClipNova SRT Subtitles');
}

export async function downloadFcpXml(project: ProjectData) {
  const clipsXml = project.clips
    .map(
      (c) =>
        `        <clip name=\"${c.title.replace(/"/g, '&quot;')}\" offset=\"${c.startTime}s\" duration=\"${c.duration}s\" track=\"${c.trackType}\" />`
    )
    .join('\n');

  const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.10\">\n  <project name=\"${project.name.replace(/"/g, '&quot;')}\">\n    <sequence format=\"${project.resolution}\" tcStart=\"0s\" renderFps=\"${project.fps}\">\n      <spine>\n${clipsXml}\n      </spine>\n    </sequence>\n  </project>\n</fcpxml>`;

  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const fileName = `${project.name.replace(/\s+/g, '_')}_Timeline.fcpxml`;
  return saveAndShareFileOnDevice(blob, fileName, 'ClipNova FCPXML Timeline');
}

export const FEATURE_IMPLEMENTATION_CHECKLIST = {
  fullyWorking: [
    'CapCut-Style Mobile App Flow: Home Screen on launch, New Project full-screen Media Picker with multi-select numbered badges, Empty Timeline except selected clips, and IndexedDB project/media persistence',
    'CapCut-Style Mobile Editor Layout: Top bar (Back, Tap-to-Rename, Export), largest Video Preview area (540p fast playback, full quality export), Slim Player Bar, Timeline with Pinch-Zoom & Action Row, and 14-Tool Bottom Bar',
    'Single Open Bottom Sheet (~40dvh) with Accordions (only 1 group open at a time) and 44px touch sliders with numeric value & per-slider Reset button',
    'Language Switcher (English default on first launch via clipnova_lang_v3 + हिन्दी Devanagari) in Settings with instant i18n dictionary',
    'Non-Destructive Adjustment Layers & Effect Overlay Layers (separate tracks, apply color/tone & 18+ procedural shaders to all tracks below)',
    'Reliable Android WebView Media Importer: URL.createObjectURL, hidden DOM <video muted playsinline preload="metadata"> with 5s timeout, 0.1s seek thumbnail capture, and step-by-step toasts',
    'React Error Boundary + window.onerror / unhandledrejection Red Diagnostic Box with "Copy error" button + Build ID display',
  ],
  partialBestEffort: [
    'In-Browser AI Background Remover, Chroma Key Green Screen, Video Stabilization & Motion Tracking (best-effort canvas compositing)',
    'Smooth Slow-Motion & Voice Changer (time-remap curve interpolation & Web Audio pitch/filter synthesis)',
  ],
  missingNativeOnly: [
    'Hardware MediaCodec H.264 MP4 container muxing (Android WebView MediaRecorder outputs .webm; warning badge is shown in Export Modal)',
  ],
};
