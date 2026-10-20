// Real UI and real model; only failure/cancellation cases inject network delays.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.CERUM_PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:5175/';
if (!/^http:\/\/127\.0\.0\.1:5175\/?$/.test(url) && !/^https:\/\/cerum(?:-[a-z0-9-]+)?\.vercel\.app\/?$/.test(url)) throw new Error('Use Cerum local or Vercel URL');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const report = [];
const folder = new URL('../../.cache/on-demand-browser/', import.meta.url);
await mkdir(folder, { recursive: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], analyses = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', async (r) => {
      if (r.url().endsWith('/api/analyze-audio')) analyses.push({ status: r.status(), ...(r.ok() ? await r.json() : {}) });
    });
    await page.addInitScript(() => localStorage.setItem('cerum.genre-scope.v1', 'nearby'));
    const open = async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'Search songs' }).fill('One Dance Drake');
      await page.locator('.search-results button').first().waitFor({ timeout: 30000 });
      await page.locator('.search-results button').first().click();
      await page.locator('.recommendation-card').nth(11).waitFor({ timeout: 60000 });
    };
    await open();
    await page.locator('.live-ai-status[data-state="ready"]').waitFor({ timeout: 60000 });
    assert.equal(analyses.length, 1);
    assert.equal(analyses[0].status, 200);
    assert.ok(analyses[0].row.preview_seconds <= 30);
    assert.ok(await page.locator('.ai-match-tag').count() > 0);
    const close = page.getByRole('button', { name: 'Close full-screen visuals', exact: true });
    await close.click();
    await page.waitForFunction(() => !document.querySelector('.fullscreen-visualizer'));
    await page.waitForFunction(() => document.querySelector('.mix-player')?.dataset.playing === 'true');
    assert.equal(await page.locator('.mix-player').getAttribute('data-active-index'), '0', 'AI refinement must not restart or skip the playing queue');
    assert.ok(Number(await page.locator('.mix-player input[aria-label="Preview position"]').inputValue()) > 1);
    await page.locator('.intelligence-status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL(`${mobile ? 'mobile' : 'desktop'}.png`, folder).pathname.replace(/^\/(.:\/)/, '$1') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await open();
    await page.locator('.live-ai-status[data-state="ready"]').waitFor({ timeout: 30000 });
    assert.match(await page.locator('.live-ai-status').innerText(), /Cached AI fingerprint/);
    assert.equal(analyses.length, 1, 'Repeat selection reuses derived device cache, not another inference');
    assert.deepEqual(errors, []);
    report.push({ browser: `Edge ${browser.version()}`, viewport: mobile ? '390×844 emulation' : '1440×1000',
      inference_ms: analyses[0].elapsed_ms, seconds_analyzed: analyses[0].row.preview_seconds,
      cache: 'reload reused derived fingerprint; no second inference', playingQueue: 'not reset by AI refinement', errors });
    await context.close();
  }
  // A delayed obsolete request must not replace a newer selected song's results.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('cerum.genre-scope.v1', 'nearby'));
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  await page.route('**/api/analyze-audio', async (route) => {
    started();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 503, json: { detail: 'test outage' } }).catch(() => {});
  });
  await page.goto(url);
  const search = page.getByRole('textbox', { name: 'Search songs' });
  await search.fill('One Dance Drake');
  await page.locator('.search-results button').filter({ hasText: 'One Dance' }).first().click();
  await pending;
  await page.getByRole('button', { name: 'Close full-screen visuals', exact: true }).click();
  await search.fill('Blinding Lights The Weeknd');
  await page.locator('.search-results button').filter({ hasText: 'Blinding Lights' }).first().click();
  await page.locator('.recommendation-card').nth(11).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  assert.ok(await page.locator('.intelligence-status').getByText(/Your preview is AI-indexed/).count());
  assert.equal(await page.locator('.live-ai-status[data-state="unavailable"]').count(), 0);
  await page.getByRole('button', { name: 'Close full-screen visuals', exact: true }).click();
  await search.fill('One Dance Drake');
  await page.locator('.search-results button').filter({ hasText: 'One Dance' }).first().click();
  try { await page.locator('.live-ai-status[data-state="unavailable"]').waitFor({ timeout: 30000 }); }
  catch (error) { console.log('Failure diagnostics:', await page.locator('.intelligence-status').innerText()); throw error; }
  assert.equal(await page.locator('.recommendation-card').count(), 12);
  await page.waitForFunction(() => document.querySelector('.mix-player')?.dataset.playing === 'true');
  report.push({ cancellation: 'late obsolete error ignored after selecting another song', outage: 'acoustic suggestions and playback continue' });
  await context.close();
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
