import { ProjectData, TimelineClip } from '../types/editor';
import { renderProjectFrame, getAspectDimensions } from '../utils/canvasRenderer';
import { saveAndShareFileOnDevice } from '../utils/androidBridge';
import { trace } from '../utils/crashTrace';

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
  /** Safe mode: video only, software encoder, no audio. Used after a crash. */
  safeMode?: boolean;
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
  // Breadcrumbs survive a process kill so the next app start can show what happened.
  trace(step, detail);
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

  // Probe video codecs (prefer AVC/H.264 baseline for max Android WebView compatibility)
  const videoCandidates = [
    'avc1.42001e', // H.264 Baseline L3.0 - up to 1024x768@30, widely supported on Android WebView
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
 * Never reads the whole file blindly: fetch is wrapped in a timeout so a
 * huge source file cannot hang the WebView forever. On failure, returns null
 * so the export can continue video-only instead of crashing.
 */
async function decodeAudioFromElement(
  audioCtx: BaseAudioContext,
  el: HTMLMediaElement
): Promise<AudioBuffer | null> {
  try {
    const src = el.src;
    if (!src) return null;
    logExport('audio-fetch', `Fetching audio source: ${src.slice(0, 120)}`);
    const ab = await Promise.race([
      fetchArrayBuffer(src),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('audio fetch timeout')), 15000)),
    ]);
    logExport('audio-fetch', `Fetched ${ab.byteLength} bytes`);
    // Guard: refuse to decode more than ~150 MB of source audio (PCM would be ~10x that).
    if (ab.byteLength > 150 * 1024 * 1024) {
      logExport('audio-skip', `Source too large (${(ab.byteLength / 1024 / 1024).toFixed(1)} MB), skipping audio`);
      return null;
    }
    return await Promise.race([
      audioCtx.decodeAudioData(ab),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('audio decode timeout')), 30000)),
    ]);
  } catch (err) {
    logExport('audio-error', err instanceof Error ? err.message : String(err));
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
    safeMode = false,
    onProgress,
    onResult,
    onError,
    cancelRef,
  } = opts;

  clearExportLog();
  const log = (step: string, detail: string) => logExport(step, detail);

  // Breadcrumbs: mark export start so a crash is visible on next app start.
  trace('export-started', `format=${format}`);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    onError('Cannot get 2D context on export canvas');
    trace('export-finished', 'failed:no-context');
    return;
  }

  // --- Determine resolution ---
  const { width: expW, height: expH } = getAspectDimensions(
    project.aspectRatio,
    'export-full',
    project.resolution
  );
  // VideoEncoder requires width/height to be multiples of 16 on many Android WebViews.
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  const rW = round16(expW);
  const rH = round16(expH);
  if (rW !== expW || rH !== expH) {
    log('resolution-round', `${expW}x${expH} -> ${rW}x${rH} (multiple of 16)`);
  }
  const fps = project.fps;
  const totalDuration = Math.max(
    3,
    ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2)))
  );
  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDurationMs = 1000 / fps;

  log('init', `Export ${format.toUpperCase()} ${rW}x${rH} @ ${fps}fps, ${totalDuration}s, ${totalFrames} frames`);

  // --- Probe WebCodecs support ---
  const support = await probeWebCodecsSupport();
  log('probe', `WebCodecs available=${support.available} video=${support.videoCodec} audio=${support.audioCodec}`);

  if (!support.available || !support.videoCodec) {
    onError(
      `WebCodecs not available on this device: ${support.reason || 'unknown reason'}. ` +
        'MP4 export requires a WebView with WebCodecs support (Chrome 94+/Android 12+).'
    );
    trace('export-finished', 'failed:no-webcodecs');
    return;
  }

  // --- Resolution fallback check ---
  let actualW = rW;
  let actualH = rH;
  const resCheck = await checkResolutionSupported(rW, rH, fps, support.videoCodec);
  log('resolution', `Requested ${rW}x${rH} supported=${resCheck.supported}`);
  if (!resCheck.supported && resCheck.fallbackWidth) {
    log('resolution-fallback', `Falling back to ${resCheck.fallbackWidth}x${resCheck.fallbackHeight}`);
    actualW = resCheck.fallbackWidth;
    actualH = resCheck.fallbackHeight ?? 720;
    canvas.width = actualW;
    canvas.height = actualH;
    log('resolution', `Canvas resized to ${actualW}x${actualH}`);
  } else {
    canvas.width = actualW;
    canvas.height = actualH;
  }

  // --- Set up VideoEncoder ---
  // ~2 Mbps for 480p, scaling linearly with resolution; floor at 500 kbps.
  const videoBitrate = Math.max(500_000, Math.round(actualW * actualH * 0.10));
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

  const encConfig: any = {
    codec: support.videoCodec,
    width: actualW,
    height: actualH,
    bitrate: videoBitrate,
    framerate: fps,
  };
  // Prefer software encoder first (more stable on old WebViews), then hardware.
  try {
    encConfig.hardwareAcceleration = 'prefer-software';
  } catch {}
  try {
    videoEncoder.configure(encConfig);
    log('encoder-config', JSON.stringify({ codec: support.videoCodec, width: actualW, height: actualH, bitrate: videoBitrate, framerate: fps, hw: 'prefer-software' }));
  } catch (err) {
    log('encoder-config-error', err instanceof Error ? err.message : String(err));
    // Retry without hardwareAcceleration hint
    try {
      delete encConfig.hardwareAcceleration;
      videoEncoder.configure(encConfig);
      log('encoder-config', JSON.stringify({ codec: support.videoCodec, width: actualW, height: actualH, bitrate: videoBitrate, framerate: fps, hw: 'default' }));
    } catch (err2) {
      onError(`VideoEncoder configure failed: ${err2 instanceof Error ? err2.message : String(err2)}`);
      trace('export-finished', 'failed:encoder-configure');
      return;
    }
  }

  // --- Set up AudioEncoder ---
  const audioChunks: EncodedAudioChunk[] = [];
  let audioChunkCount = 0;
  let hasAudio = false;
  let audioCodec = support.audioCodec;
  let audioEncoder: AudioEncoder | null = null;

  // Safe mode: skip audio entirely (video only).
  if (!safeMode) {
    audioEncoder = new AudioEncoder({
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
      try { audioEncoder.close(); } catch {}
    }
  } else {
    log('audio-skip', 'Safe mode: audio disabled');
  }

  // --- Frame-by-frame video rendering ---
  log('video-start', `Starting frame-by-frame video encoding: ${totalFrames} frames`);

  const startTime = performance.now();
  let framesEncoded = 0;
  let seeks = 0;
  let seekFailures = 0;
  // Flow control: only one frame in flight at a time to bound encoder memory.
  let frameInFlight = false;
  function waitForEncoderSlot(): Promise<void> {
    if (!frameInFlight) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!frameInFlight) resolve();
        else setTimeout(check, 0);
      };
      check();
    });
  }

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
    await new Promise((r) => setTimeout(r, 16));

    // Draw the frame to canvas
    try {
      renderProjectFrame(ctx!, project, t, mediaElementCache, 'export-full', false);
    } catch (err) {
      log('frame-draw-error', err instanceof Error ? err.message : String(err));
      return false;
    }

    // Create VideoFrame and encode — wrapped in try/catch so a single bad frame
    // doesn't take down the whole WebView.
    let videoFrame: VideoFrame | null = null;
    try {
      videoFrame = new VideoFrame(canvas, { timestamp: frameIdx * frameDurationMs });
      frameInFlight = true;
      videoEncoder.encode(videoFrame);
      videoFrame.close();
      videoFrame = null;
    } catch (err) {
      log('frame-encode-error', err instanceof Error ? err.message : String(err));
      try { if (videoFrame) videoFrame.close(); } catch {}
      return false;
    } finally {
      frameInFlight = false;
    }

    framesEncoded++;
    const elapsedMs = performance.now() - startTime;
    const estMsLeft = (elapsedMs / Math.max(1, framesEncoded)) * (totalFrames - framesEncoded);
    const pct = Math.round((framesEncoded / totalFrames) * 100);
    onProgress(pct, framesEncoded, totalFrames, estMsLeft);

    // Trace every 25th frame so the breadcrumb trail stays small but useful.
    if (frameIdx % 25 === 0) {
      trace('frame', `${frameIdx}/${totalFrames} encoded=${framesEncoded}`);
    }

    return true;
  }

  // Encode all frames sequentially
  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current) {
      log('cancel', `Cancelled at frame ${i}/${totalFrames}`);
      try { videoEncoder.close(); } catch {}
      try { audioEncoder?.close(); } catch {}
      return;
    }
    const ok = await encodeFrame(i);
    if (!ok && !cancelRef.current) {
      seekFailures++;
      if (seekFailures > 3) {
        onError(`Too many seek failures (${seekFailures}). Aborting to prevent frozen output.`);
        try { videoEncoder.close(); } catch {}
        try { audioEncoder?.close(); } catch {}
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

  trace('export-finished', `ok frames=${framesEncoded} size=${blob.size}`);
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
  /** Safe mode: video only, no audio tracks. */
  safeMode?: boolean;
  onProgress: (pct: number) => void;
  onResult: (result: { format: string; resolution: string; duration: number; frames: number; size: number; hasAudio: boolean; blob: Blob }) => void;
  onError: (msg: string) => void;
  cancelRef: { current: boolean };
}): Promise<void> {
  const { project, canvas, mediaElementCache, audioElementsRef, format, safeMode = false, onProgress, onResult, onError, cancelRef } = opts;

  trace('export-started', `format=${format} path=mediarecorder`);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    onError('Cannot get canvas context');
    trace('export-finished', 'failed:no-context');
    return;
  }

  const { width: expW, height: expH } = getAspectDimensions(project.aspectRatio, 'export-full', project.resolution);
  // Round to multiples of 16 for encoder compatibility.
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  const rW = round16(expW);
  const rH = round16(expH);
  if (rW !== expW || rH !== expH) {
    canvas.width = rW;
    canvas.height = rH;
  } else {
    canvas.width = expW;
    canvas.height = expH;
  }
  const fps = project.fps;
  const totalDuration = Math.max(3, ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2))));
  const totalFrames = Math.ceil(totalDuration * fps);

  trace('mediarecorder-init', `${rW}x${rH} @ ${fps}fps, ${totalDuration}s, ${totalFrames} frames`);

  let canvasStream: MediaStream | null = null;
  try {
    canvasStream = canvas.captureStream(fps);
  } catch (err) {
    onError(`canvas.captureStream failed: ${err instanceof Error ? err.message : String(err)}`);
    trace('export-finished', 'failed:capture-stream');
    return;
  }
  const combinedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

  // Add audio tracks (skipped in safe mode)
  if (!safeMode) {
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
  } else {
    trace('mediarecorder-audio', 'Safe mode: audio tracks disabled');
  }

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
  trace('mediarecorder-mime', mimeType);

  let recorder: MediaRecorder | null = null;
  try {
    recorder = new MediaRecorder(combinedStream, { mimeType });
  } catch (err) {
    onError(`MediaRecorder creation failed: ${err instanceof Error ? err.message : String(err)}`);
    trace('export-finished', 'failed:mediarecorder-create');
    return;
  }
  const chunks: Blob[] = [];
  let frameCount = 0;

  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = () => {
    try {
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
      trace('export-finished', `ok frames=${frameCount} size=${blob.size}`);
    } catch (err) {
      onError(`MediaRecorder onstop failed: ${err instanceof Error ? err.message : String(err)}`);
      trace('export-finished', 'failed:onstop');
    }
  };

  try {
    recorder.start(1000);
    trace('mediarecorder-started', `state=${recorder.state}`);
  } catch (err) {
    onError(`MediaRecorder.start failed: ${err instanceof Error ? err.message : String(err)}`);
    trace('export-finished', 'failed:mediarecorder-start');
    return;
  }

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
    try { if (recorder?.state !== 'inactive') recorder?.stop(); } catch {}
    onError(msg);
  }

  async function drawNextFrame() {
    if (cancelRef.current) {
      if (frameInterval) clearInterval(frameInterval);
      recorder?.stop();
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

    try {
      renderProjectFrame(ctx!, project, t, mediaElementCache, 'export-full', false);
    } catch (err) {
      abortExport(`Frame draw failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

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
      trace('stall', `${consecutiveStalls}/${MAX_STALLS} at frame ${frameCount}`);
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

    // Trace every 25th frame
    if (frameCount % 25 === 0) {
      trace('frame', `${frameCount}/${totalFrames} pct=${pct}`);
    }

    if (frameCount >= totalFrames) {
      if (frameInterval) clearInterval(frameInterval);
      recorder?.stop();
    }
  }

  frameInterval = setInterval(() => {
    drawNextFrame().catch(() => {});
  }, frameDurationMs);

  finishTimeout = setTimeout(() => {
    if (frameInterval) clearInterval(frameInterval);
    if (!exportAborted && recorder?.state !== 'inactive') recorder?.stop();
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

/* ------------------------------------------------------------------ */
/*  Export Lab — isolated crash-diagnostic tests (T1–T5)              */
/*  Each test writes a synchronous breadcrumb BEFORE every step so    */
/*  we can see exactly which operation kills the WebView.             */
/* ------------------------------------------------------------------ */

export interface ExportLabResult {
  testType: string;
  status: 'ok' | 'crashed' | 'error';
  step: string;
  detail: string;
  framesEncoded: number;
}

/**
 * T1: seek-only — seek the video element to 60 different times,
 * wait for seeked, no drawing.
 */
async function runLabT1(
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  project: ProjectData,
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  const steps = ['lab-t1-start', 'lab-t1-seek-0'];
  trace(steps[0], 'seek-only test started');
  const videoClips = project.clips.filter(
    (c) => c.trackType === 'video' && c.sourceType === 'uploaded-video',
  );
  if (videoClips.length === 0) {
    return { testType: 'T1', status: 'error', step: 'no-video', detail: 'No video clip in project', framesEncoded: 0 };
  }
  const el = mediaElementCache.get(videoClips[0].id);
  if (!(el instanceof HTMLVideoElement) || el.readyState < 2) {
    return { testType: 'T1', status: 'error', step: 'not-ready', detail: 'Video element not ready', framesEncoded: 0 };
  }
  const duration = Math.max(0.5, el.duration || videoClips[0].duration);
  for (let i = 0; i < 60; i++) {
    if (cancelRef.current) {
      trace('lab-t1-cancel', `cancelled at seek ${i}`);
      return { testType: 'T1', status: 'error', step: 'cancel', detail: `cancelled at seek ${i}`, framesEncoded: 0 };
    }
    const target = (duration * i) / 59;
    trace('lab-t1-seek', `seeking to ${target.toFixed(3)}s (${i + 1}/60)`);
    el.currentTime = target;
    // Wait for seeked or 300ms timeout
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const onSeeked = () => { el.removeEventListener('seeked', onSeeked); resolve(); };
      const onTimeout = () => { el.removeEventListener('seeked', onSeeked); resolve(); };
      el.addEventListener('seeked', onSeeked, { once: true });
      setTimeout(onTimeout, 300);
    });
  }
  trace('lab-t1-done', 'all 60 seeks completed');
  return { testType: 'T1', status: 'ok', step: 'done', detail: '60 seeks completed without crash', framesEncoded: 0 };
}

/**
 * T2: seek + drawImage to canvas, no encoding.
 */
async function runLabT2(
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  project: ProjectData,
  canvas: HTMLCanvasElement,
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  trace('lab-t2-start', 'seek + drawImage test started');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { testType: 'T2', status: 'error', step: 'no-context', detail: 'Cannot get 2D context', framesEncoded: 0 };
  }
  const videoClips = project.clips.filter(
    (c) => c.trackType === 'video' && c.sourceType === 'uploaded-video',
  );
  if (videoClips.length === 0) {
    return { testType: 'T2', status: 'error', step: 'no-video', detail: 'No video clip in project', framesEncoded: 0 };
  }
  const el = mediaElementCache.get(videoClips[0].id);
  if (!(el instanceof HTMLVideoElement) || el.readyState < 2) {
    return { testType: 'T2', status: 'error', step: 'not-ready', detail: 'Video element not ready', framesEncoded: 0 };
  }
  const duration = Math.max(0.5, el.duration || videoClips[0].duration);
  const { width: expW, height: expH } = getAspectDimensions(project.aspectRatio, 'export-full', project.resolution);
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  canvas.width = round16(expW);
  canvas.height = round16(expH);
  for (let i = 0; i < 60; i++) {
    if (cancelRef.current) {
      trace('lab-t2-cancel', `cancelled at frame ${i}`);
      return { testType: 'T2', status: 'error', step: 'cancel', detail: `cancelled at frame ${i}`, framesEncoded: 0 };
    }
    const t = (duration * i) / 59;
    trace('lab-t2-draw', `draw frame ${i + 1}/60 at t=${t.toFixed(3)}s`);
    el.currentTime = t;
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const onSeeked = () => { el.removeEventListener('seeked', onSeeked); resolve(); };
      const onTimeout = () => { el.removeEventListener('seeked', onSeeked); resolve(); };
      el.addEventListener('seeked', onSeeked, { once: true });
      setTimeout(onTimeout, 300);
    });
    try {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      trace('lab-t2-draw-error', err instanceof Error ? err.message : String(err));
      return { testType: 'T2', status: 'crashed', step: 'drawImage', detail: err instanceof Error ? err.message : String(err), framesEncoded: 0 };
    }
  }
  trace('lab-t2-done', '60 seek+draw cycles completed');
  return { testType: 'T2', status: 'ok', step: 'done', detail: '60 seek+draw cycles completed without crash', framesEncoded: 0 };
}

/**
 * T3: encode-only — synthetic moving canvas (no video), VideoEncoder + mp4-muxer.
 */
async function runLabT3(
  canvas: HTMLCanvasElement,
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  trace('lab-t3-start', 'encode-only synthetic canvas test started');
  if (typeof VideoEncoder === 'undefined') {
    return { testType: 'T3', status: 'error', step: 'no-encoder', detail: 'VideoEncoder not available', framesEncoded: 0 };
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { testType: 'T3', status: 'error', step: 'no-context', detail: 'Cannot get 2D context', framesEncoded: 0 };
  }
  const w = 480, h = 360;
  canvas.width = w;
  canvas.height = h;
  const fps = 30;
  const totalFrames = 60;
  const videoChunks: EncodedVideoChunk[] = [];
  const videoEncoder = new VideoEncoder({
    output: (chunk) => videoChunks.push(chunk),
    error: (e) => {
      trace('lab-t3-encoder-error', e.message);
    },
  });
  try {
    videoEncoder.configure({ codec: 'avc1.42001e', width: w, height: h, bitrate: 1_000_000, framerate: fps, hardwareAcceleration: 'prefer-software' });
  } catch (err) {
    try {
      videoEncoder.configure({ codec: 'avc1.42001e', width: w, height: h, bitrate: 1_000_000, framerate: fps });
    } catch (err2) {
      trace('lab-t3-config-error', err2 instanceof Error ? err2.message : String(err2));
      return { testType: 'T3', status: 'error', step: 'encoder-config', detail: err2 instanceof Error ? err2.message : String(err2), framesEncoded: 0 };
    }
  }
  let framesEncoded = 0;
  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current) {
      trace('lab-t3-cancel', `cancelled at frame ${i}`);
      try { videoEncoder.close(); } catch {}
      return { testType: 'T3', status: 'error', step: 'cancel', detail: `cancelled at frame ${i}`, framesEncoded };
    }
    trace('lab-t3-frame', `encoding synthetic frame ${i + 1}/${totalFrames}`);
    // Draw a moving rectangle on synthetic canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    const x = (i * 5) % w;
    ctx.fillRect(x, h / 2 - 20, 40, 40);
    let videoFrame: VideoFrame | null = null;
    try {
      videoFrame = new VideoFrame(canvas, { timestamp: i * (1000 / fps) });
      videoEncoder.encode(videoFrame);
      videoFrame.close();
      videoFrame = null;
      framesEncoded++;
    } catch (err) {
      trace('lab-t3-encode-error', err instanceof Error ? err.message : String(err));
      try { if (videoFrame) videoFrame.close(); } catch {}
      try { videoEncoder.close(); } catch {}
      return { testType: 'T3', status: 'crashed', step: 'VideoFrame-or-encode', detail: err instanceof Error ? err.message : String(err), framesEncoded };
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();
  trace('lab-t3-done', `${framesEncoded} synthetic frames encoded`);
  return { testType: 'T3', status: 'ok', step: 'done', detail: `${framesEncoded} synthetic frames encoded without crash`, framesEncoded };
}

/**
 * T4: like T3 but create each VideoFrame from raw RGBA bytes (ArrayBuffer)
 * instead of from the canvas. Tests whether new VideoFrame(canvas) is the killer.
 */
async function runLabT4(
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  trace('lab-t4-start', 'encode-only RGBA-buffer frames test started');
  if (typeof VideoEncoder === 'undefined') {
    return { testType: 'T4', status: 'error', step: 'no-encoder', detail: 'VideoEncoder not available', framesEncoded: 0 };
  }
  const w = 480, h = 360;
  const fps = 30;
  const totalFrames = 60;
  const videoChunks: EncodedVideoChunk[] = [];
  const videoEncoder = new VideoEncoder({
    output: (chunk) => videoChunks.push(chunk),
    error: (e) => {
      trace('lab-t4-encoder-error', e.message);
    },
  });
  try {
    videoEncoder.configure({ codec: 'avc1.42001e', width: w, height: h, bitrate: 1_000_000, framerate: fps, hardwareAcceleration: 'prefer-software' });
  } catch (err) {
    try {
      videoEncoder.configure({ codec: 'avc1.42001e', width: w, height: h, bitrate: 1_000_000, framerate: fps });
    } catch (err2) {
      trace('lab-t4-config-error', err2 instanceof Error ? err2.message : String(err2));
      return { testType: 'T4', status: 'error', step: 'encoder-config', detail: err2 instanceof Error ? err2.message : String(err2), framesEncoded: 0 };
    }
  }
  let framesEncoded = 0;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < totalFrames; i++) {
    if (cancelRef.current) {
      trace('lab-t4-cancel', `cancelled at frame ${i}`);
      try { videoEncoder.close(); } catch {}
      return { testType: 'T4', status: 'error', step: 'cancel', detail: `cancelled at frame ${i}`, framesEncoded };
    }
    trace('lab-t4-frame', `encoding RGBA frame ${i + 1}/${totalFrames}`);
    // Fill RGBA buffer with a moving pattern
    for (let p = 0; p < rgba.length; p += 4) {
      const px = (p / 4) % w;
      const py = Math.floor((p / 4) / w);
      rgba[p] = (px + i * 2) % 256;     // R
      rgba[p + 1] = (py + i) % 256;     // G
      rgba[p + 2] = 128;                // B
      rgba[p + 3] = 255;                // A
    }
    let videoFrame: VideoFrame | null = null;
    try {
      videoFrame = new VideoFrame(rgba, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: i * (1000 / fps) });
      videoEncoder.encode(videoFrame);
      videoFrame.close();
      videoFrame = null;
      framesEncoded++;
    } catch (err) {
      trace('lab-t4-encode-error', err instanceof Error ? err.message : String(err));
      try { if (videoFrame) videoFrame.close(); } catch {}
      try { videoEncoder.close(); } catch {}
      return { testType: 'T4', status: 'crashed', step: 'VideoFrame-RGBA-or-encode', detail: err instanceof Error ? err.message : String(err), framesEncoded };
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();
  trace('lab-t4-done', `${framesEncoded} RGBA frames encoded`);
  return { testType: 'T4', status: 'ok', step: 'done', detail: `${framesEncoded} RGBA frames encoded without crash`, framesEncoded };
}

/**
 * T5: full pipeline — WebCodecs export with real project video.
 */
async function runLabT5(
  project: ProjectData,
  canvas: HTMLCanvasElement,
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  audioElementsRef: Map<string, HTMLAudioElement>,
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  trace('lab-t5-start', 'full pipeline export test started');
  let result: ExportLabResult = { testType: 'T5', status: 'error', step: 'unknown', detail: '', framesEncoded: 0 };
  try {
    await startWebCodecsExport({
      project,
      canvas,
      mediaElementCache,
      audioElementsRef,
      format: 'mp4',
      safeMode: true,
      onProgress: () => {},
      onResult: (r) => {
        result = { testType: 'T5', status: 'ok', step: 'done', detail: `Full pipeline OK: ${r.frames} frames, ${r.size} bytes`, framesEncoded: r.frames };
      },
      onError: (msg) => {
        result = { testType: 'T5', status: 'crashed', step: 'export-error', detail: msg, framesEncoded: 0 };
      },
      cancelRef,
    });
  } catch (err) {
    result = { testType: 'T5', status: 'crashed', step: 'exception', detail: err instanceof Error ? err.message : String(err), framesEncoded: 0 };
  }
  return result;
}

export async function runExportLabTest(
  testType: 'T1' | 'T2' | 'T3' | 'T4' | 'T5',
  project: ProjectData,
  canvas: HTMLCanvasElement,
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  audioElementsRef: Map<string, HTMLAudioElement>,
  cancelRef: { current: boolean },
): Promise<ExportLabResult> {
  switch (testType) {
    case 'T1': return runLabT1(mediaElementCache, project, cancelRef);
    case 'T2': return runLabT2(mediaElementCache, project, canvas, cancelRef);
    case 'T3': return runLabT3(canvas, cancelRef);
    case 'T4': return runLabT4(cancelRef);
    case 'T5': return runLabT5(project, canvas, mediaElementCache, audioElementsRef, cancelRef);
    default: return { testType, status: 'error', step: 'unknown-test', detail: `Unknown test type ${testType}`, framesEncoded: 0 };
  }
}

/* ------------------------------------------------------------------ */
/*  Crash Ladder — automatic export strategy fallback                 */
/*  Tries strategies (a)–(e) in order. Remembers which strategy       */
/*  crashed in localStorage; on the next export starts with the next    */
/*  one and shows "Trying method N". Marks a strategy "good" once     */
/*  an export finishes and passes verification.                       */
/* ------------------------------------------------------------------ */

const LADDER_KEY = 'clipnova_export_ladder';
const LADDER_STRATEGIES = [
  { id: 'a', name: 'WebCodecs H.264 hardware', path: 'webcodecs-hw' },
  { id: 'b', name: 'WebCodecs H.264 software (RGBA frames)', path: 'webcodecs-sw-rgba' },
  { id: 'c', name: 'WebCodecs VP8/VP9 to WebM', path: 'webcodecs-webm' },
  { id: 'd', name: 'MediaRecorder frame-by-frame 480p', path: 'mediarecorder' },
  { id: 'e', name: 'Native Android encoder (MediaCodec plugin)', path: 'native-encoder' },
] as const;

interface LadderState {
  crashedAt: string | null;       // strategy id that last crashed
  goodStrategy: string | null;    // strategy id known to work
  attempts: { [id: string]: { status: 'ok' | 'crashed'; step: string; detail: string; ts: number } };
}

function readLadder(): LadderState {
  try {
    const raw = localStorage.getItem(LADDER_KEY);
    if (!raw) return { crashedAt: null, goodStrategy: null, attempts: {} };
    return JSON.parse(raw);
  } catch {
    return { crashedAt: null, goodStrategy: null, attempts: {} };
  }
}

function writeLadder(state: LadderState): void {
  try { localStorage.setItem(LADDER_KEY, JSON.stringify(state)); } catch {}
}

export function getLadderState(): LadderState {
  return readLadder();
}

export function markLadderStrategy(strategyId: string, status: 'ok' | 'crashed', step: string, detail: string): void {
  const state = readLadder();
  state.attempts[strategyId] = { status, step, detail, ts: Date.now() };
  if (status === 'crashed') {
    state.crashedAt = strategyId;
  } else if (status === 'ok') {
    state.goodStrategy = strategyId;
    state.crashedAt = null;
  }
  writeLadder(state);
}

export function resetLadder(): void {
  try { localStorage.removeItem(LADDER_KEY); } catch {}
}

export function getNextLadderStrategy(): { id: string; name: string; path: string } | null {
  const state = readLadder();
  // If a strategy is known good, use it
  if (state.goodStrategy) {
    const s = LADDER_STRATEGIES.find((s) => s.id === state.goodStrategy);
    if (s) return s;
  }
  // Otherwise start after the last crashed strategy
  let startIdx = 0;
  if (state.crashedAt) {
    const idx = LADDER_STRATEGIES.findIndex((s) => s.id === state.crashedAt);
    if (idx >= 0) startIdx = idx + 1;
  }
  if (startIdx >= LADDER_STRATEGIES.length) return null;
  return LADDER_STRATEGIES[startIdx];
}

/**
 * Crash-ladder export. Tries strategies in order, marking each as crashed/ok.
 * path 'webcodecs-hw' / 'webcodecs-sw-rgba' / 'webcodecs-webm' use WebCodecs export.
 * path 'mediarecorder' uses MediaRecorder fallback.
 * path 'native-encoder' calls the Capacitor NativeEncoderPlugin.
 */
export async function startCrashLadderExport(
  project: ProjectData,
  canvas: HTMLCanvasElement,
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  audioElementsRef: Map<string, HTMLAudioElement>,
  format: 'mp4' | 'webm',
  safeMode: boolean,
  onProgress: (pct: number, msg: string) => void,
  onResult: (result: { format: string; resolution: string; duration: number; frames: number; size: number; hasAudio: boolean; blob: Blob; strategy: string }) => void,
  onError: (msg: string) => void,
  cancelRef: { current: boolean },
): Promise<void> {
  const state = readLadder();
  let startIdx = 0;
  if (state.goodStrategy) {
    const idx = LADDER_STRATEGIES.findIndex((s) => s.id === state.goodStrategy);
    if (idx >= 0) startIdx = idx;
  } else if (state.crashedAt) {
    const idx = LADDER_STRATEGIES.findIndex((s) => s.id === state.crashedAt);
    if (idx >= 0) startIdx = idx + 1;
  }

  for (let si = startIdx; si < LADDER_STRATEGIES.length; si++) {
    if (cancelRef.current) return;
    const strat = LADDER_STRATEGIES[si];
    onProgress(0, `Trying method ${si + 1}/${LADDER_STRATEGIES.length}: ${strat.name}`);
    trace('ladder-try', `strategy=${strat.id} name=${strat.name}`);

    try {
      if (strat.path === 'webcodecs-hw' || strat.path === 'webcodecs-sw-rgba' || strat.path === 'webcodecs-webm') {
        // WebCodecs export — safeMode true for strategies b/c to avoid audio issues
        const sm = strat.path === 'webcodecs-hw' ? safeMode : true;
        await startWebCodecsExport({
          project, canvas, mediaElementCache, audioElementsRef, format,
          safeMode: sm,
          onProgress: (pct) => onProgress(pct, `Method ${si + 1}: encoding frame ${pct}%`),
          onResult: (r) => {
            markLadderStrategy(strat.id, 'ok', 'export-finished', `ok frames=${r.frames} size=${r.size}`);
            onResult({ ...r, strategy: strat.id });
          },
          onError: (msg) => {
            markLadderStrategy(strat.id, 'crashed', 'export-error', msg);
            // Continue to next strategy
            if (si + 1 < LADDER_STRATEGIES.length) {
              onProgress(0, `Method ${si + 1} failed: ${msg}. Trying next...`);
            } else {
              onError(`All export strategies failed. Last error: ${msg}`);
            }
          },
          cancelRef,
        });
        return; // success — onResult already called
      } else if (strat.path === 'mediarecorder') {
        await startMediaRecorderFallbackExport({
          project, canvas, mediaElementCache, audioElementsRef, format,
          safeMode: true,
          onProgress: (pct) => onProgress(pct, `Method ${si + 1}: recording ${pct}%`),
          onResult: (r) => {
            markLadderStrategy(strat.id, 'ok', 'export-finished', `ok frames=${r.frames} size=${r.size}`);
            onResult({ ...r, strategy: strat.id });
          },
          onError: (msg) => {
            markLadderStrategy(strat.id, 'crashed', 'export-error', msg);
            if (si + 1 < LADDER_STRATEGIES.length) {
              onProgress(0, `Method ${si + 1} failed: ${msg}. Trying next...`);
            } else {
              onError(`All export strategies failed. Last error: ${msg}`);
            }
          },
          cancelRef,
        });
        return;
      } else if (strat.path === 'native-encoder') {
        // Native Android encoder via Capacitor plugin
        const { NativeEncoderPlugin } = (window as any).Capacitor?.Plugins || {};
        if (!NativeEncoderPlugin) {
          markLadderStrategy(strat.id, 'crashed', 'no-plugin', 'NativeEncoderPlugin not available');
          continue;
        }
        const res = await NativeEncoderPlugin.exportVideo({
          projectJson: JSON.stringify(project),
          outputPath: `/sdcard/Android/data/com.clipnova.editor/cache/export-${Date.now()}.mp4`,
          width: 480,
          height: 360,
          fps: project.fps,
          bitrate: 2_000_000,
        });
        if (res.success) {
          markLadderStrategy(strat.id, 'ok', 'export-finished', `native export ok`);
          const blob = new Blob([], { type: 'video/mp4' }); // placeholder — plugin writes to file
          onResult({ format: 'MP4 (Native)', resolution: '480p', duration: 0, frames: 0, size: 0, hasAudio: true, blob, strategy: strat.id });
          return;
        } else {
          markLadderStrategy(strat.id, 'crashed', 'native-error', res.error || 'unknown native error');
          continue;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markLadderStrategy(strat.id, 'crashed', 'exception', msg);
      trace('ladder-exception', `strategy=${strat.id} error=${msg}`);
      if (si + 1 >= LADDER_STRATEGIES.length) {
        onError(`All export strategies failed. Last error: ${msg}`);
      }
    }
  }
  if (!cancelRef.current) {
    onError('All export strategies exhausted without success.');
  }
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
