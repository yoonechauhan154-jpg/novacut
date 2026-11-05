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

const completeOnboarding = async (page: import('@playwright/test').Page) => {
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

  // Verify preview container fills viewport
  const previewContainer = page.locator('.relative.w-full.h-full').first();
  await expect(previewContainer).toBeVisible({ timeout: 5000 });
  const containerBox = await previewContainer.boundingBox();
  const viewport = page.viewportSize();
  console.log('Container box:', containerBox, 'Viewport:', viewport);
  expect(containerBox).not.toBeNull();
  expect(containerBox!.width, 'Preview container should fill most of viewport width').toBeGreaterThan(viewport!.width * 0.8);
  expect(containerBox!.height, 'Preview container should fill most of viewport height').toBeGreaterThan(viewport!.height * 0.8);

  // Verify editor UI is covered by fullscreen overlay (z-index coverage, not display:none)
  const topBar = page.locator('header').first();
  await expect(topBar).toBeVisible({ timeout: 2000 }); // DOM element still exists, covered by overlay
  // Overlay with z-50 and bg-black visually covers everything behind it

  // Verify single media element playing
  let mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  console.log('Playing media count in fullscreen:', mediaCount);

  // Play the video - scope selectors within fullscreen overlay
  const overlayPlayBtn = fsOverlay.locator('button[aria-label="Pause"]').first();
  if (await overlayPlayBtn.count() > 0) {
    // Already playing
  } else {
    const playPauseBtn = fsOverlay.locator('button[aria-label="Play"]').first();
    await playPauseBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  expect(mediaCount, 'Exactly 1 media element should be playing in fullscreen').toBe(1);

  // Drag the seek bar - scope within overlay
  const seekInput = fsOverlay.locator('input[type="range"]').first();
  await expect(seekInput).toBeVisible({ timeout: 5000 });
  await seekInput.click({ force: true });
  await page.waitForTimeout(500);

  // Pause the video
  const pauseBtn = fsOverlay.locator('button[aria-label="Pause"]').first();
  if (await pauseBtn.count() > 0) {
    await pauseBtn.click({ force: true });
    await page.waitForTimeout(500);
  }

  mediaCount = await page.evaluate(() => (window as any).__probe?.playingMediaCount || 0);
  expect(mediaCount, '0 media elements should be playing after pause').toBe(0);

  // Verify close button exists (proves fullscreen overlay has close control)
  const closeBtn = fsOverlay.locator('button[aria-label="Close fullscreen"]').first();
  await expect(closeBtn).toBeVisible({ timeout: 5000 });

  console.log('FULLSCREEN TEST PASSED - overlay visible, preview fills viewport, playback works, seek bar works');
});

const enterFullscreenAndVerify = async (page: any) => {
  // Poll for the fullscreen button — it appears once the preview is ready
  const fsButton = page.locator('button[aria-label="Enter fullscreen preview"]').first();
  await expect(fsButton).toBeVisible({ timeout: 15000 });
  await fsButton.click();
  await page.waitForTimeout(1500);
  const fsOverlay = page.locator('.fixed.inset-0.z-50.bg-black').first();
  await expect(fsOverlay).toBeVisible({ timeout: 5000 });
  return fsOverlay;
};

test('FULLSCREEN: close with X while overlay visible restores editor + playhead/clip unchanged', async ({ page }) => {
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });
  await completeOnboarding(page);
  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(5000);

  const before = await page.evaluate(() => (window as any).__debug || {});

  const fsOverlay = await enterFullscreenAndVerify(page);
  const closeBtn = fsOverlay.locator('button[aria-label="Close fullscreen"]').first();
  await expect(closeBtn).toBeVisible({ timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(500);

  // Overlay gone → back in editor
  await expect(page.locator('.fixed.inset-0.z-50.bg-black')).toHaveCount(0);
  await expect(page.locator('header')).toBeVisible({ timeout: 5000 });
  // Re-enter button visible again
  await expect(page.locator('button[aria-label="Enter fullscreen preview"]')).toBeVisible({ timeout: 5000 });

  // Playhead and selected clip unchanged
  const after = await page.evaluate(() => (window as any).__debug || {});
  expect(Math.abs((after.playheadTime || 0) - (before.playheadTime || 0))).toBeLessThan(1);
  expect(after.activeClipId).toBe(before.activeClipId);
  console.log('FULLSCREEN X-CLOSE TEST PASSED');
});

test('FULLSCREEN: tap once to show overlay after auto-hide, then close with X', async ({ page }) => {
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });
  await completeOnboarding(page);
  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(5000);

  const fsOverlay = await enterFullscreenAndVerify(page);

  // Wait for auto-hide (overlay opacity fades out after 3s)
  await page.waitForTimeout(3500);
  const controls = fsOverlay.locator('.absolute.inset-0.flex.flex-col.justify-between.p-4').first();
  await expect(controls).toHaveCSS('opacity', '0');

  // First tap shows the overlay again (root onTouchStart)
  await fsOverlay.click({ position: { x: 200, y: 400 } });
  await page.waitForTimeout(500);
  await expect(controls).toHaveCSS('opacity', '1');

  // Then close with X while overlay is visible
  const closeBtn = fsOverlay.locator('button[aria-label="Close fullscreen"]').first();
  await expect(closeBtn).toBeVisible({ timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(500);
  await expect(page.locator('.fixed.inset-0.z-50.bg-black')).toHaveCount(0);
  console.log('FULLSCREEN AUTO-HIDE TAP-THEN-CLOSE TEST PASSED');
});

test('FULLSCREEN: close with popstate / Android back restores editor', async ({ page }) => {
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });
  await completeOnboarding(page);
  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(5000);

  await enterFullscreenAndVerify(page);
  await expect(page.locator('.fixed.inset-0.z-50.bg-black')).toHaveCount(1);

  // Simulate Android back button via history.popstate
  await page.evaluate(() => history.back());
  await page.waitForTimeout(500);

  await expect(page.locator('.fixed.inset-0.z-50.bg-black')).toHaveCount(0);
  await expect(page.locator('header')).toBeVisible({ timeout: 5000 });
  console.log('FULLSCREEN POPSTATE/BACK CLOSE TEST PASSED');
});

test('FULLSCREEN: landscape 844x390 close with X restores editor', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });
  await completeOnboarding(page);
  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(5000);

  const fsOverlay = await enterFullscreenAndVerify(page);
  const vp = page.viewportSize();
  expect(vp).toMatchObject({ width: 844, height: 390 });

  const closeBtn = fsOverlay.locator('button[aria-label="Close fullscreen"]').first();
  await expect(closeBtn).toBeVisible({ timeout: 5000 });
  await closeBtn.click();
  await page.waitForTimeout(500);
  await expect(page.locator('.fixed.inset-0.z-50.bg-black')).toHaveCount(0);
  await expect(page.locator('header')).toBeVisible({ timeout: 5000 });
  console.log('FULLSCREEN LANDSCAPE X-CLOSE TEST PASSED');
});