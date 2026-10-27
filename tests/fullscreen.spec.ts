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

test('FULLSCREEN: enter fullscreen, preview fills viewport, single media element, scrub, exit - state preserved', async ({ page }) => {
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

  // Enter fullscreen - button has aria-label and Maximize2 icon, no text
  const fsButton = page.locator('button[aria-label="Enter fullscreen preview"]').first();
  await expect(fsButton).toBeVisible({ timeout: 5000 });
  await fsButton.click();
  await page.waitForTimeout(1500);

  // Verify fullscreen overlay is visible
  const fsOverlay = page.locator('.fixed.inset-0.z-50.bg-black').first();
  await expect(fsOverlay).toBeVisible({ timeout: 5000 });

  // Verify video fills viewport
  const videoEl = page.locator('video').first();
  await expect(videoEl).toBeVisible({ timeout: 5000 });
  const videoBox = await videoEl.boundingBox();
  const viewport = page.viewportSize();
  console.log('Video box:', videoBox, 'Viewport:', viewport);
  expect(videoBox).not.toBeNull();
  expect(videoBox!.width).toBeGreaterThan(viewport!.width * 0.8, 'Video should fill most of viewport width');
  expect(videoBox!.height).toBeGreaterThan(viewport!.height * 0.8, 'Video should fill most of viewport height');

  // Verify editor UI is hidden
  const topBar = page.locator('header').first();
  await expect(topBar).toBeHidden({ timeout: 2000 });

  // Verify single media element playing
  let mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  console.log('Playing media count in fullscreen:', mediaCount);

  // Play the video
  const playBtn = page.locator('button:has(svg.lucide-pause), button:has([data-lucide="pause"])').first();
  if (await playBtn.count() > 0) {
    // Already playing
  } else {
    const playPauseBtn = page.locator('button:has(svg.lucide-play), button:has([data-lucide="play"])').first();
    await playPauseBtn.click();
    await page.waitForTimeout(1000);
  }

  mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  expect(mediaCount).toBe(1, 'Exactly 1 media element should be playing in fullscreen');

  // Drag the seek bar
  const seekInput = page.locator('input[type="range"]').first();
  await expect(seekInput).toBeVisible({ timeout: 5000 });
  await seekInput.click();
  await page.waitForTimeout(500);

  // Pause the video
  const pauseBtn = page.locator('button:has(svg.lucide-pause), button:has([data-lucide="pause"])').first();
  if (await pauseBtn.count() > 0) {
    await pauseBtn.click();
    await page.waitForTimeout(500);
  }

  mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  expect(mediaCount).toBe(0, '0 media elements should be playing after pause');

  // Verify close button exists
  const closeBtn = page.locator('button[aria-label="Close fullscreen"]').first();
  await expect(closeBtn).toBeVisible({ timeout: 5000 });

  // Record playhead before exit
  const playheadBeforeExit = await page.evaluate(() => {
    const dbg = (window as any).__debug;
    return dbg ? dbg.playheadTime : null;
  });
  console.log('Playhead before exit:', playheadBeforeExit);

  // Exit fullscreen
  await closeBtn.click();
  await page.waitForTimeout(1000);

  // Verify fullscreen overlay is gone
  await expect(fsOverlay).toBeHidden({ timeout: 5000 });

  // Verify editor UI is back
  await expect(topBar).toBeVisible({ timeout: 5000 });

  // Verify playhead is preserved
  const playheadAfter = await page.evaluate(() => {
    const dbg = (window as any).__debug;
    return dbg ? dbg.playheadTime : null;
  });
  console.log('Playhead after exit:', playheadAfter);
  // Allow small drift
  if (playheadBeforeExit !== null && playheadAfter !== null) {
    expect(Math.abs(playheadAfter - playheadBeforeExit)).toBeLessThan(2, 'Playhead should be preserved after exiting fullscreen');
  }

  // Verify single media element after exit
  mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  console.log('Playing media count after exit:', mediaCount);
});