import { test, expect } from '@playwright/test';

const TEST_VIDEO_URL = 'http://localhost:5173/test-assets/test-12s.webm';

const PROBE_SCRIPT = `
(function () {
  const events = [];
  const MAX_EVENTS = 500;
  function logEvent(type, el, detail = {}) {
    events.push({ t: performance.now(), type, id: el.id || el.dataset.clipId || 'unknown', tag: el.tagName, ...detail });
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
  window.__probe = {
    get events() { return events; },
    clearEvents() { events.length = 0; },
    getMediaState() {
      const els = [];
      document.querySelectorAll('video, audio').forEach((el) => {
        els.push({ id: el.id || el.dataset.clipId || 'unknown', tag: el.tagName, currentTime: el.currentTime, paused: el.paused, readyState: el.readyState, muted: el.muted, volume: el.volume, duration: el.duration });
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

test('EXPORT: produces a real video (not a photo) with audio, respecting format selector', async ({ page, browserName }) => {
  test.setTimeout(180000); // 3 minutes — frame-by-frame encoding with CPU throttling is slow
  // CPU throttling x4 to simulate a slow mobile device
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

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

  // Open export modal
  const headerExportBtn = page.locator('button:has-text("Export"), button:has-text("एक्सपोर्ट")').first();
  await expect(headerExportBtn).toBeVisible({ timeout: 5000 });
  await headerExportBtn.click();
  await page.waitForTimeout(500);

  // Select MP4 format
  const mp4Btn = page.locator('button:has-text("MP4")').first();
  await expect(mp4Btn).toBeVisible({ timeout: 5000 });
  await mp4Btn.click();
  await page.waitForTimeout(300);

  // Start export
  const startBtn = page.locator('button:has-text("Render & Export"), button:has-text("वीडियो रेंडर")').first();
  await expect(startBtn).toBeVisible({ timeout: 5000 });
  await startBtn.click();

  // Wait for export to complete (with CPU throttling x6, frame-by-frame encoding is slow)
  // Poll for either success (Export Result) or error toast
  let exportDone = false;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    const resultVisible = await page.locator('text=Export Result').count();
    const errorVisible = await page.locator('text=Export error, text=Export warning').count();
    if (resultVisible > 0 || errorVisible > 0) {
      exportDone = true;
      break;
    }
  }
  expect(exportDone).toBeTruthy('Export did not complete within 120 seconds');

  // Verify export result is shown
  const exportResult = page.locator('text=Export Result').first();
  await expect(exportResult).toBeVisible({ timeout: 5000 });

  const verified = await page.locator('text=Verified').first();
  await expect(verified).toBeVisible({ timeout: 5000 });

  // Download the exported file
  const downloadPromise = page.waitForEvent('download');
  const saveBtn = page.locator('button:has-text("Save to Phone & Share")').first();
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();
  const download = await downloadPromise;

  const downloadPath = download.suggestedFilename();
  const filePath = `test-exports/${downloadPath}`;
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
    videoCodec: videoStreams[0]?.codec_name,
    audioCodec: audioStreams[0]?.codec_name,
  }));

  // Assertions
  expect(videoStreams.length).toBeGreaterThan(0, 'Exported file must have a video stream');
  expect(audioStreams.length).toBeGreaterThan(0, 'Exported file must have an audio stream');

  const duration = parseFloat(format.duration || '0');
  // Project is 12s (test clip), expect within 5%
  expect(duration).toBeGreaterThan(12 * 0.95, `Video duration should be ~12s, got ${duration}s`);
  expect(duration).toBeLessThan(12 * 1.05, `Video duration should be ~12s, got ${duration}s`);

  // More than 100 frames (not 1 frame = photo) - at 30fps for 12s = 360 frames
  const nbFrames = videoStreams[0]?.nb_frames;
  if (nbFrames && nbFrames !== 'unknown') {
    expect(parseInt(nbFrames, 10)).toBeGreaterThan(100, `Expected >100 frames, got ${nbFrames}`);
  }

  // Container format should be MP4
  const formatName = format.format_name || '';
  expect(formatName).toMatch(/mp4|isom/, `Expected MP4 container, got: ${formatName}`);

  console.log('EXPORT TEST PASSED:', downloadPath);
});

test('EXPORT: negative test - stalled video element aborts with clear error', async ({ page }) => {
  test.setTimeout(120000);
  // CPU throttling x4 to simulate a slow mobile device
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.addInitScript(PROBE_SCRIPT);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });

  await completeOnboarding(page);

  await page.evaluate((url) => { (window as any).__TEST_VIDEO_URL__ = url; }, TEST_VIDEO_URL);
  const loadBtn = page.locator('button:has-text("Load test video")').first();
  await expect(loadBtn).toBeVisible({ timeout: 5000 });
  await loadBtn.click();
  await page.waitForTimeout(3000);

  // Simulate a stalled video element: block seeked events forever
  await page.evaluate(() => {
    const orig = HTMLVideoElement.prototype.addEventListener;
    HTMLVideoElement.prototype.addEventListener = function (type, listener, options) {
      if (type === 'seeked') {
        // Never fire seeked - simulates stalled media
        return;
      }
      return orig.call(this, type, listener, options);
    };
  });

  const headerExportBtn = page.locator('button:has-text("Export"), button:has-text("एक्सपोर्ट")').first();
  await expect(headerExportBtn).toBeVisible({ timeout: 5000 });
  await headerExportBtn.click();
  await page.waitForTimeout(500);

  const mp4Btn = page.locator('button:has-text("MP4")').first();
  await expect(mp4Btn).toBeVisible({ timeout: 5000 });
  await mp4Btn.click();
  await page.waitForTimeout(300);

  const startBtn = page.locator('button:has-text("Render & Export"), button:has-text("वीडियो रेंडर")').first();
  await expect(startBtn).toBeVisible({ timeout: 5000 });
  await startBtn.click();

  // Wait for error to appear (seek timeouts: 3s each × 3 retries ≈ 9s)
  await page.waitForTimeout(15000);

  // Should show an error toast, not success
  const errorToast = page.locator(':has-text("Export error"), :has-text("Too many seek failures"), :has-text("frames are not changing")').first();
  await expect(errorToast).toBeVisible({ timeout: 5000 });

  // Verify no Verified badge appears
  const verified = page.locator('text=Verified');
  await expect(verified).toHaveCount(0);

  console.log('NEGATIVE EXPORT TEST PASSED');
});
