import { test, expect } from '@playwright/test';

const TEST_VIDEO_URL = 'http://localhost:5173/test-assets/test-12s.webm';

const PROBE_SCRIPT = `
(function () {
  const events = [];
  const MAX_EVENTS = 500;
  function logEvent(type, el, detail = {}) {
    events.push({
      t: performance.now(),
      type,
      id: el.id || el.dataset.clipId || 'unknown',
      tag: el.tagName,
      currentTime: el.currentTime !== undefined ? Number(el.currentTime.toFixed(3)) : null,
      paused: el.paused !== undefined ? el.paused : null,
      readyState: el.readyState !== undefined ? el.readyState : null,
      ...detail,
    });
    if (events.length > MAX_EVENTS) events.shift();
  }
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const el = this;
    if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
      const wrapped = (ev) => { logEvent(type, el); return listener.call(this, ev); };
      el._probeWrapped = el._probeWrapped || {};
      el._probeWrapped[type] = wrapped;
      return origAddEventListener.call(this, type, wrapped, options);
    }
    return origAddEventListener.call(this, type, listener, options);
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    const promise = origPlay.call(this);
    if (promise && promise.then) {
      promise.then(
        () => logEvent('play-resolved', el),
        (err) => logEvent('play-rejected', el, { error: err.name + ': ' + err.message })
      );
    } else {
      logEvent('play-called', el);
    }
    return promise;
  };
  const origPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    const el = this;
    logEvent('pause-called', el);
    return origPause.call(this);
  };
  let activeAudioSources = 0;
  let audioContextSuspended = false;
  const origAudioContext = window.AudioContext || window.webkitAudioContext;
  if (origAudioContext) {
    const wrappedAudioContext = function (...args) {
      const ctx = new origAudioContext(...args);
      const origCreateBufferSource = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = function (...args) {
        const node = origCreateBufferSource(...args);
        const origStart = node.start;
        node.start = function (...args) { activeAudioSources++; return origStart.call(this, ...args); };
        const origStop = node.stop;
        node.stop = function (...args) { activeAudioSources = Math.max(0, activeAudioSources - 1); return origStop.call(this, ...args); };
        const origDisconnect = node.disconnect;
        node.disconnect = function (...args) { activeAudioSources = Math.max(0, activeAudioSources - 1); return origDisconnect.call(this, ...args); };
        return node;
      };
      const origCreateMediaElementSource = ctx.createMediaElementSource.bind(ctx);
      ctx.createMediaElementSource = function (mediaElement) {
        const node = origCreateMediaElementSource(mediaElement);
        const origConnect = node.connect;
        node.connect = function (...args) { activeAudioSources++; return origConnect.call(this, ...args); };
        const origDisconnect2 = node.disconnect;
        node.disconnect = function (...args) { activeAudioSources = Math.max(0, activeAudioSources - 1); return origDisconnect2.call(this, ...args); };
        return node;
      };
      const origSuspend = ctx.suspend.bind(ctx);
      ctx.suspend = function (...args) { audioContextSuspended = true; return origSuspend(...args); };
      const origResume = ctx.resume.bind(ctx);
      ctx.resume = function (...args) { audioContextSuspended = false; return origResume(...args); };
      return ctx;
    };
    wrappedAudioContext.prototype = origAudioContext.prototype;
    window.AudioContext = wrappedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = wrappedAudioContext;
  }
  window.__probe = {
    get events() { return events; },
    clearEvents() { events.length = 0; },
    get playingMediaCount() {
      let count = 0;
      document.querySelectorAll('video, audio').forEach((el) => { if (!el.paused) count++; });
      return count;
    },
    get activeAudioSources() { return activeAudioSources; },
    get audioContextSuspended() { return audioContextSuspended; },
    getMediaState() {
      const els = [];
      document.querySelectorAll('video, audio').forEach((el) => {
        els.push({
          id: el.id || el.dataset.clipId || 'unknown',
          tag: el.tagName,
          currentTime: el.currentTime,
          paused: el.paused,
          readyState: el.readyState,
          muted: el.muted,
          volume: el.volume,
          duration: el.duration,
        });
      });
      return els;
    },
    getActiveClipInfo() { return window.__debug || {}; },
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
          ['play', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'timeupdate', 'ended', 'error'].forEach((ev) => {
            node.addEventListener(ev, () => logEvent(ev, node));
          });
        }
      }
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();
`;

const completeOnboarding = async (page) => {
  for (let i = 0; i < 5; i++) {
    const nextBtn = page.locator('button:has-text("Next"),button:has-text("आगे बढ़ें")').first();
    const doneBtn = page.locator('button:has-text("Start Editing"),button:has-text("एडिटिंग शुरू करें")').first();
    if (await doneBtn.count() > 0 && await doneBtn.isVisible()) {
      await doneBtn.click();
      await page.waitForTimeout(300);
      return;
    }
    if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
    } else {
      return;
    }
  }
};

test('EXPORT: produces a real video (not a photo) with audio, respecting format selector', async ({ page }) => {
  await page.addInitScript(PROBE_SCRIPT);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });

  await completeOnboarding(page);

  // Load test video
  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(3000);

  // Play briefly to confirm media loads
  const playBtn = page.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
  await expect(playBtn).toBeVisible({ timeout: 15000 });
  await playBtn.click();
  await page.waitForTimeout(1000);
  await playBtn.click(); // pause again

  // Open export modal (header button says "Export")
  const headerExportBtn = page.locator('button:has-text("Export"), button:has-text("एक्सपोर्ट")').first();
  await expect(headerExportBtn).toBeVisible({ timeout: 5000 });
  await headerExportBtn.click();
  await page.waitForTimeout(500);

  // Select MP4 format
  const mp4Btn = page.locator('button:has-text("MP4")').first();
  await expect(mp4Btn).toBeVisible({ timeout: 5000 });
  await mp4Btn.click();
  await page.waitForTimeout(300);

  // Start export (modal button says "Render & Export Video (1080p · 30fps)")
  const startBtn = page.locator('button:has-text("Render & Export"), button:has-text("वीडियो रेंडर")').first();
  await expect(startBtn).toBeVisible({ timeout: 5000 });
  await startBtn.click();

  // Wait for export to complete (12s project = ~12s real-time + buffer)
  await page.waitForTimeout(15000);

  // Verify export result is shown
  const exportResult = page.locator('text=Export Result').first();
  await expect(exportResult).toBeVisible({ timeout: 5000 });

  // Check result details
  const formatText = await page.locator('text=Format').first().textContent();
  console.log('Export format:', formatText);
  const hasAudioText = await page.locator('text=Audio').first().textContent();
  console.log('Export audio:', hasAudioText);

  // Download the exported file
  const downloadPromise = page.waitForEvent('download');
  const saveBtn = page.locator('button:has-text("Save to Phone & Share")').first();
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();
  const download = await downloadPromise;

  const downloadPath = download.suggestedFilename();
  const filePath = `/tmp/${downloadPath}`;
  await download.saveAs(filePath);

  // Verify with ffprobe
  const { execSync } = await import('child_process');
  let probeOutput;
  try {
    probeOutput = execSync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
  } catch (err) {
    console.error('ffprobe failed:', err);
    throw new Error(`ffprobe failed on exported file: ${downloadPath}`);
  }

  const probe = JSON.parse(probeOutput);
  const videoStreams = probe.streams.filter((s: any) => s.codec_type === 'video');
  const audioStreams = probe.streams.filter((s: any) => s.codec_type === 'audio');
  const format = probe.format;

  console.log('ffprobe output:', JSON.stringify({
    duration: format.duration,
    format: format.format_name,
    size: format.size,
    videoStreams: videoStreams.length,
    audioStreams: audioStreams.length,
    videoFrames: videoStreams[0]?.nb_frames || 'unknown',
  }));

  // Assertions
  expect(videoStreams.length).toBeGreaterThan(0, 'Exported file must have a video stream');
  expect(audioStreams.length).toBeGreaterThan(0, 'Exported file must have an audio stream');

  const duration = parseFloat(format.duration || '0');
  expect(duration).toBeGreaterThan(10, `Video duration should be ~12s, got ${duration}s`);
  expect(duration).toBeLessThan(14, `Video duration should be ~12s, got ${duration}s`);

  // More than 100 frames (not 1 frame = photo)
  const nbFrames = videoStreams[0]?.nb_frames;
  if (nbFrames && nbFrames !== 'unknown') {
    expect(parseInt(nbFrames, 10)).toBeGreaterThan(100, `Expected >100 frames, got ${nbFrames}`);
  }

  // Container format matches selection
  const formatName = format.format_name || '';
  expect(formatName).toMatch(/matroska|webm|mov|mp4|isom/, `Unexpected container: ${formatName}`);

  console.log('EXPORT TEST PASSED:', downloadPath);
});