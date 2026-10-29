import type { ProjectData, TimelineClip } from '../types/editor';

export type CancelFlag = { current: boolean };
export type Diagnostic = (step: string, detail: string) => void;
export const abortIfCancelled = (flag: CancelFlag) => {
  if (flag.current) throw new DOMException('Export cancelled', 'AbortError');
};

export function mediaDiagnostic(el: HTMLVideoElement, target: number, reason: string) {
  const ranges = (r: TimeRanges) => Array.from({ length: r.length }, (_, i) => [r.start(i), r.end(i)]);
  const src = el.currentSrc || el.src;
  return JSON.stringify({
    reason, element: el.dataset.exportClipId || el.id, srcType: src.split(':')[0],
    attached: el.isConnected, readyState: el.readyState, networkState: el.networkState,
    error: el.error && { code: el.error.code, message: el.error.message },
    seekable: ranges(el.seekable), buffered: ranges(el.buffered), seeking: el.seeking,
    currentTime: el.currentTime, target, duration: el.duration, paused: el.paused,
    width: el.videoWidth, height: el.videoHeight,
  });
}

export function attachExportVideo(id: string) {
  const el = document.createElement('video');
  el.dataset.exportClipId = id;
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  // In the viewport and laid out: display:none/offscreen decoding can stall in WebView.
  el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:0';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
}

export async function loadVideo(el: HTMLVideoElement, src: string, cancel: CancelFlag, log: Diagnostic) {
  await new Promise<void>((resolve, reject) => {
    const end = (error?: Error) => {
      clearInterval(timer);
      el.removeEventListener('loadeddata', ready);
      el.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const ready = () => { if (el.readyState >= 2) end(); };
    const failed = () => {
      const detail = mediaDiagnostic(el, 0, 'load failed');
      log('media-load-failed', detail); end(new Error(detail));
    };
    const deadline = performance.now() + 15000;
    const timer = setInterval(() => {
      if (cancel.current) end(new DOMException('Export cancelled', 'AbortError'));
      else if (performance.now() > deadline) failed();
    }, 50);
    el.addEventListener('loadeddata', ready);
    el.addEventListener('error', failed);
    el.src = src;
    el.load();
  });
}

/** Register every callback before changing currentTime. A clock assignment is not a decoded frame. */
export async function seekVideo(el: HTMLVideoElement, target: number, cancel: CancelFlag, log: Diagnostic, timeout = 5000) {
  abortIfCancelled(cancel);
  el.pause();
  if (!Number.isFinite(el.currentTime) || !Number.isFinite(target)) {
    const detail = mediaDiagnostic(el, target, 'invalid media clock');
    log('seek-failed', detail); throw new Error(detail);
  }
  target = Math.max(0, Math.min(target, Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.001) : target));
  if (!el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - target) < 0.0005) return;
  await new Promise<void>((resolve, reject) => {
    let callback = 0;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true; clearInterval(timer);
      el.removeEventListener('seeked', onSeeked); el.removeEventListener('error', onError);
      if (callback) el.cancelVideoFrameCallback(callback);
      err ? reject(err) : resolve();
    };
    const fail = (reason: string) => {
      const detail = mediaDiagnostic(el, target, reason); log('seek-failed', detail);
      finish(new Error(detail));
    };
    const onError = () => fail('decoder error');
    const onSeeked = () => {
      // seeked guarantees current decoded data; rVFC below also catches WebView presentation.
      if (el.readyState >= 2 && !el.seeking && Math.abs(el.currentTime - target) < 0.05) finish();
    };
    const deadline = performance.now() + timeout;
    const timer = setInterval(() => {
      if (cancel.current) finish(new DOMException('Export cancelled', 'AbortError'));
      else if (performance.now() > deadline) fail('seek timeout');
    }, 25);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onError);
    if (typeof el.requestVideoFrameCallback === 'function') {
      callback = el.requestVideoFrameCallback((_now, meta) => {
        if (!el.seeking && Math.abs(meta.mediaTime - target) < 0.08) finish();
      });
    }
    try { el.currentTime = target; } catch (e) { fail(String(e)); }
  });
}

/** Consecutive forward frames use decoder playback, with seeks only for cuts/discontinuities. */
export async function advanceVideo(el: HTMLVideoElement, target: number, fps: number, cancel: CancelFlag, log: Diagnostic) {
  abortIfCancelled(cancel);
  const previous = Number(el.dataset.exportTime ?? NaN);
  if (!Number.isFinite(previous) || target < previous || target - previous > 0.5 ||
      typeof el.requestVideoFrameCallback !== 'function') {
    await seekVideo(el, target, cancel, log);
  } else if (target > previous + 0.0001) {
    await new Promise<void>((resolve, reject) => {
      let callback = 0, settled = false;
      const finish = (err?: Error) => {
        if (settled) return; settled = true; clearInterval(timer);
        if (callback) el.cancelVideoFrameCallback(callback);
        el.pause(); err ? reject(err) : resolve();
      };
      const deadline = performance.now() + 5000;
      const timer = setInterval(() => {
        if (cancel.current) finish(new DOMException('Export cancelled', 'AbortError'));
        else if (performance.now() > deadline) {
          const detail = mediaDiagnostic(el, target, 'playback frame timeout');
          log('seek-failed', detail); finish(new Error(detail));
        }
      }, 25);
      const frame: VideoFrameRequestCallback = (_now, meta) => {
        if (meta.mediaTime >= target - 0.5 / fps) finish();
        else callback = el.requestVideoFrameCallback(frame);
      };
      callback = el.requestVideoFrameCallback(frame);
      el.playbackRate = 1;
      void el.play().catch(err => finish(err));
    });
    // Slow JavaScript/decoder scheduling may overshoot. Never encode an unrelated future frame.
    if (Math.abs(el.currentTime - target) > Math.max(0.08, 2 / fps)) await seekVideo(el, target, cancel, log);
  }
  el.dataset.exportTime = String(target);
}

export function clipSourceTime(clip: TimelineClip, time: number, sourceDuration: number) {
  const offset = Math.max(0, time - clip.startTime) * clip.speed;
  const source = clip.frozen ? clip.sourceStart :
    clip.reversed ? clip.sourceEnd - offset : clip.sourceStart + offset;
  return Math.max(0, Math.min(source, Math.max(0, sourceDuration - 0.001)));
}

export async function createExportMedia(project: ProjectData, cancel: CancelFlag, log: Diagnostic) {
  const media = new Map<string, HTMLVideoElement | HTMLImageElement>();
  const audio = new Map<string, HTMLAudioElement>();
  const dispose = () => {
    for (const el of [...media.values(), ...audio.values()]) {
      if (el instanceof HTMLMediaElement) { el.pause(); el.removeAttribute('src'); el.load(); }
      el.remove();
    }
    media.clear(); audio.clear();
  };
  try {
    // Separate element per clip, including split clips that share one preview element.
    for (const clip of project.clips) {
      abortIfCancelled(cancel);
      if (!clip.mediaUrl) continue;
      if (clip.sourceType === 'uploaded-video') {
        const el = attachExportVideo(clip.id); media.set(clip.id, el);
        await loadVideo(el, clip.mediaUrl, cancel, log);
      } else if (clip.sourceType === 'uploaded-image') {
        const el = new Image(); media.set(clip.id, el); el.src = clip.mediaUrl;
        await Promise.race([el.decode(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Image decode timeout')), 15000))]);
      } else if (clip.sourceType === 'uploaded-audio') {
        const el = new Audio(); el.src = clip.mediaUrl; audio.set(clip.id, el);
      }
    }
    return { media, audio, dispose };
  } catch (err) { dispose(); throw err; }
}
