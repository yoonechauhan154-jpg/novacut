import { test, expect } from '@playwright/test';

const TEST_VIDEO_URL = 'http://localhost:5173/test-assets/test-12s.webm';

test('DIAGNOSTIC: check what happens after loading test video', async ({ page }) => {
  const errors: string[] = [];
  const consoleMessages: string[] = [];
  
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

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
  console.log('DIAG: Load test video button found');
  await loadBtn.click();
  console.log('DIAG: Clicked load test video button');

  // Wait and check state
  await page.waitForTimeout(5000);
  console.log('DIAG: Waited 5 seconds after click');

  // Check URL
  console.log('DIAG: Current URL:', page.url());

  // Check what's visible
  const bodyText = await page.locator('body').textContent();
  console.log('DIAG: Body text (first 500 chars):', bodyText?.slice(0, 500));

  // Look for any video element
  const videoCount = await page.locator('video').count();
  console.log('DIAG: Video elements:', videoCount);

  // Look for play button
  const playBtnCount = await page.locator('button[aria-label="Play"], button[aria-label="Pause"]').count();
  console.log('DIAG: Play buttons:', playBtnCount);

  // Look for error toasts
  const toastCount = await page.locator('[role="alert"], .toast, [class*="toast"]').count();
  console.log('DIAG: Toast elements:', toastCount);

  // Screenshot
  await page.screenshot({ path: '/home/ubuntu/novacut/test-results/diagnostic.png', fullPage: true });

  console.log('DIAG: Errors:', errors);
  console.log('DIAG: Console messages:', consoleMessages);
});
