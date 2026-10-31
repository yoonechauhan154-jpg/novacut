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
    logEvent('play-called', el);
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

test('BUG B: no audio echo after pause', async ({ page }) => {
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

  await playBtn.click();
  await page.waitForTimeout(2000);

  const pauseBtn = page.locator('button[aria-label="Pause"]').first();
  if (await pauseBtn.count() > 0) {
    await pauseBtn.click();
  } else {
    await playBtn.click();
  }
  await page.waitForTimeout(500);

  const samples: Array<{ wallClock: number; playingCount: number; activeSources: number; ctxSuspended: boolean }> = [];
  const startWall = Date.now();

  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    const wallElapsed = (Date.now() - startWall) / 1000;
    const probe = await page.evaluate(() => {
      const p = (window as any).__probe;
      return {
        playingCount: p?.playingMediaCount ?? 0,
        activeSources: p?.activeAudioSources ?? 0,
        ctxSuspended: p?.audioContextSuspended ?? false,
      };
    });
    samples.push({
      wallClock: wallElapsed,
      playingCount: probe.playingCount,
      activeSources: probe.activeSources,
      ctxSuspended: probe.ctxSuspended,
    });
  }

  const allEvents = await page.evaluate(() => (window as any).__probe?.events);

  // Find the pause event timestamp
  const pauseEvent = allEvents.find((e: any) => e.type === 'pause-called');
  const pauseTs = pauseEvent?.t ?? 0;
  // Only count forbidden events more than 100ms after pause (avoid promise race conditions)
  const eventsAfterPause = allEvents.filter(
    (e: any) => e.t > pauseTs + 100
  );
  const forbiddenAfterPause = eventsAfterPause.filter(
    (e: any) =>
      e.type === 'seeking' ||
      e.type === 'seeked' ||
      (e.type === 'play-called' && !e.paused) ||
      e.type === 'timeupdate'
  );

  const anyPlaying = samples.some((s) => s.playingCount > 0);
  expect(anyPlaying, `Found playing media after pause: ${JSON.stringify(samples.filter(s => s.playingCount > 0))}`).toBe(false);

  const anySources = samples.some((s) => s.activeSources > 0);
  expect(anySources, `Found active audio sources after pause: ${JSON.stringify(samples.filter(s => s.activeSources > 0))}`).toBe(false);

  const allSuspended = samples.every((s) => s.ctxSuspended);
  expect(allSuspended, `AudioContext not suspended after pause`).toBe(true);

  console.log('BUG B samples:', JSON.stringify(samples));
  console.log('BUG B forbidden events after pause:', JSON.stringify(forbiddenAfterPause.slice(0,10)));

  expect(forbiddenAfterPause.length, `Forbidden events after pause: ${JSON.stringify(forbiddenAfterPause.slice(0,10))}`).toBe(0);
});
