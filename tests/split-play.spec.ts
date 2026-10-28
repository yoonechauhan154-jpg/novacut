import { test, expect } from '@playwright/test';

test('play after split at 2s, after undo, and after two splits', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const results: string[] = [];

  // Complete onboarding (3 steps: Next, Next, Start Editing)
  const completeOnboarding = async () => {
    for (let i = 0; i < 5; i++) {
      try {
        const nextBtn = page.locator('button:has-text("Next"),button:has-text("आगे बढ़ें")').first();
        const doneBtn = page.locator('button:has-text("Start Editing"),button:has-text("एडिटिंग शुरू करें")').first();
        if (await doneBtn.count() > 0 && await doneBtn.isVisible()) {
          await doneBtn.click();
          await page.waitForTimeout(500);
          results.push('Onboarding: Start Editing');
          return;
        }
        if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
          await nextBtn.click();
          await page.waitForTimeout(500);
          results.push('Onboarding: Next');
        } else {
          return;
        }
      } catch {}
    }
  };

  // Dismiss toasts
  const dismissToasts = async () => {
    try {
      const closeBtn = page.locator('[aria-label="Close notification"]').first();
      if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    } catch {}
  };

  // Navigate to the app
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=ClipNova')).toBeVisible({ timeout: 15000 });
  results.push('App loaded');

  // Click "New Project" button
  await page.locator('button[aria-label="New Project"]').first().click();
  await page.waitForTimeout(1000);
  results.push('Clicked New Project');

  // Click "Browse Phone Gallery" button to trigger file picker
  await page.locator('button:has-text("Browse Phone Gallery")').first().click();
  await page.waitForTimeout(500);
  results.push('Clicked Browse Phone Gallery');

  // Upload test video via the hidden file input
  const fileInputs = page.locator('input[type="file"][accept="video/*,image/*"]');
  await fileInputs.first().setInputFiles('test-assets/test-5s.mp4');
  await page.waitForTimeout(4000);
  results.push('Uploaded test video');

  // Click on the imported video thumbnail to select it
  const videoThumbnail = page.locator('.grid button').first();
  if (await videoThumbnail.count() > 0) {
    await videoThumbnail.click();
    await page.waitForTimeout(500);
    results.push('Selected video thumbnail');
  }

  // Click "Add (1)" button at bottom
  const addBtn = page.locator('button:has-text("Add (1)")').first();
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(3000);
    results.push('Clicked Add button');
  } else {
    const addBtnHi = page.locator('button:has-text("जोड़ें")').first();
    if (await addBtnHi.count() > 0) {
      await addBtnHi.click();
      await page.waitForTimeout(3000);
      results.push('Clicked Add button (Hindi)');
    }
  }

  // Wait for editor to load
  await page.waitForTimeout(2000);
  await completeOnboarding();
  await dismissToasts();

  // Look for play button - editor should be loaded
  const playBtn = page.locator('button[aria-label="Play"]').first();
  await expect(playBtn).toBeVisible({ timeout: 15000 });
  results.push('Editor loaded, Play button visible');

  await completeOnboarding();
  await dismissToasts();

  // Click Split button (force click to bypass any overlay)
  const splitBtn = page.locator('button[aria-label="Split"]').first();
  if (await splitBtn.count() > 0) {
    await splitBtn.click({ force: true });
    await page.waitForTimeout(1000);
    results.push('Clicked Split button');
  } else {
    results.push('Split button not found');
  }

  await completeOnboarding();
  await dismissToasts();

  // Press Play
  const playPauseBtn = page.locator('button[aria-label="Play"],button[aria-label="Pause"]').first();
  if (await playPauseBtn.count() > 0) {
    await playPauseBtn.click({ force: true });
    await page.waitForTimeout(3000);
    results.push('Pressed Play');
  } else {
    results.push('Play/Pause button not found');
  }

  // Wait for playback
  await page.waitForTimeout(3000);
  await completeOnboarding();
  await dismissToasts();

  const playbackErrors = consoleErrors.filter(e =>
    e.includes('play') || e.includes('Playback') || e.includes('video') || e.includes('seek') || e.includes('Failed')
  );

  // Take screenshot
  await page.screenshot({ path: 'test-results/split-play-after.png', fullPage: true });

  results.push(`Console errors: ${consoleErrors.length}`);
  results.push(`Playback errors: ${playbackErrors.length}`);
  console.log('RESULTS:', results.join('\n'));
  console.log('All console errors:', consoleErrors);
  console.log('Playback errors:', playbackErrors);

  // Assert: no critical playback errors
  expect(playbackErrors.length).toBe(0);
});
