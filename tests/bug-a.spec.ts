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

test('BUG A: play continuously across split point after split', async ({ page }) => {
  await page.addInitScript(PROBE_SCRIPT);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });

  const completeOnboarding = async () => {
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
  await completeOnboarding();

  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);

  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(3000);

  const playBtn = page.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
  await expect(playBtn).toBeVisible({ timeout: 15000 });

  // Play for 2 seconds
  await playBtn.click();
  await page.waitForTimeout(2000);

  // Verify video is playing
  let state = await page.evaluate(() => (window as any).__probe?.getMediaState?.());
  let playing = state.filter((e: any) => !e.paused);
  expect(playing.length).toBeGreaterThan(0);

  // Split at playhead (playhead is at ~2s, split creates clips at 0-2s and 2s-end)
  const splitBtn = page.locator('button[aria-label="Split"]').first();
  await expect(splitBtn).toBeVisible({ timeout: 5000 });
  await splitBtn.click({ force: true });
  await page.waitForTimeout(1000);

  // After split, video should still be playing (button shows "Pause")
  state = await page.evaluate(() => (window as any).__probe?.getMediaState?.());
  playing = state.filter((e: any) => !e.paused);
  console.log('DIAG after split - playing:', playing.length, 'mediaState:', JSON.stringify(state));

  // Click Pause to stop playback
  const pauseBtn = page.locator('button[aria-label="Pause"]').first();
  if (await pauseBtn.count() > 0) {
    await pauseBtn.click();
  } else {
    await playBtn.click();
  }
  await page.waitForTimeout(500);

  // Verify paused
  state = await page.evaluate(() => (window as any).__probe?.getMediaState?.());
  playing = state.filter((e: any) => !e.paused);
  expect(playing.length).toBe(0, 'Video should be paused after split');

  // Now press Play to resume across split point
  const playPauseBtn = page.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
  await playPauseBtn.click();
  await page.waitForTimeout(500);

  // Sample playback every 250ms for 5 seconds
  const samples: Array<Record<string, unknown>> = [];
  const startWall = Date.now();
  let playRejected = false;

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Playback error') || text.includes('play-rejected')) {
      playRejected = true;
    }
  });

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const wallElapsed = (Date.now() - startWall) / 1000;
    state = await page.evaluate(() => (window as any).__probe?.getMediaState?.());
    playing = state.filter((e: any) => !e.paused);
    const dbg = await page.evaluate(() => (window as any).__debug || null);
    if (playing.length > 0) {
      samples.push({
        wallClock: wallElapsed,
        playhead: playing[0].currentTime,
        readyState: playing[0].readyState,
        paused: playing[0].paused,
        debug: dbg,
      });
    }
  }

  const allEvents = await page.evaluate(() => (window as any).__probe?.events);
  const waitingStalled = allEvents.filter((e: any) => e.type === 'waiting' || e.type === 'stalled');

  console.log('BUG A samples:', JSON.stringify(samples));
  console.log('BUG A waiting/stalled:', waitingStalled.length);
  console.log('BUG A playRejected:', playRejected);

  // --- ASSERTIONS for Bug A ---
  expect(samples.length).toBeGreaterThan(5, 'No playing samples after pressing Play post-split');
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];

  // 1. Playhead must not jump backwards (no wrap to 0 after split)
  let prevPlayhead: number | null = null;
  let backwardJumps = 0;
  for (const s of samples) {
    if (prevPlayhead !== null && s.playhead < prevPlayhead - 0.5) {
      backwardJumps++;
    }
    prevPlayhead = s.playhead;
  }
  expect(backwardJumps).toBe(0, `Found ${backwardJumps} backward playhead jumps (wrap to 0) after split+play`);

  // 2. App-internal playheadTime must not jump backwards (catches split-clip revert)
  let prevDbgTime: number | null = null;
  let dbgBackwardJumps = 0;
  for (const s of samples) {
    const t = (s as any).debug?.playheadTime;
    if (t !== undefined && prevDbgTime !== null && t < prevDbgTime - 0.5) {
      dbgBackwardJumps++;
    }
    if (t !== undefined) prevDbgTime = t;
  }
  expect(dbgBackwardJumps).toBe(0, `Found ${dbgBackwardJumps} backward playheadTime jumps in app state after split+play`);

  // 3. activeClipId must stay on the split clip, not revert to the original clip
  const clipIds = samples.map((s: any) => s.debug?.activeClipId).filter(Boolean);
  const splitClipId = clipIds.find((id: string) => id && id.includes('split'));
  if (splitClipId) {
    const revertedToOriginal = clipIds.some((id: string) => id && !id.includes('split') && id !== splitClipId);
    expect(revertedToOriginal).toBe(false, `activeClipId reverted from split clip '${splitClipId}' to original clip`);
  }

  // 4. Playhead must advance by at least 1.0s somewhere
  const maxPlayhead = Math.max(...samples.map((s) => s.playhead));
  const minPlayhead = Math.min(...samples.map((s) => s.playhead));
  const playheadAdvanced = maxPlayhead - minPlayhead > 1.0;
  expect(playheadAdvanced).toBe(true, `Playhead did not advance by 1s after split+play. Range: [${minPlayhead}, ${maxPlayhead}]`);

  // 5. isPlaying must stay true throughout (no silent stop)
  const stoppedSamples = samples.filter((s: any) => s.debug && s.debug.isPlaying === false);
  expect(stoppedSamples.length).toBe(0, `Found ${stoppedSamples.length} samples where app reports isPlaying=false mid-playback`);

  expect(waitingStalled.length).toBe(0, `Found waiting/stalled events: ${JSON.stringify(waitingStalled.slice(0,5))}`);

  const lowReadyState = samples.filter((s) => s.readyState < 2);
  const consecutiveLow = lowReadyState.length;
  expect(consecutiveLow).toBeLessThanOrEqual(2, `Found ${consecutiveLow} samples with readyState < 2 after split+play: ${JSON.stringify(lowReadyState.slice(0,5))}`);

  const wallDiff = lastSample.wallClock - firstSample.wallClock;
  const playheadDiff = lastSample.playhead - firstSample.playhead;
  if (wallDiff > 0 && playheadDiff > 0) {
    const ratio = playheadDiff / wallDiff;
    expect(ratio).toBeGreaterThan(0.8, 'Playhead advancing slower than real-time');
    expect(ratio).toBeLessThan(1.2, 'Playhead advancing faster than real-time');
  }

  expect(playRejected).toBe(false);
});
