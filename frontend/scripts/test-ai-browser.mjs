// Own-app browser QA. Override CERUM_PLAYWRIGHT_MODULE when using a bundled runtime.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CERUM_PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:5175/';
if (!/^http:\/\/127\.0\.0\.1:5175\/?$/.test(url) && !/^https:\/\/cerum(?:-[a-z0-9-]+)?\.vercel\.app\/?$/.test(url)) {
  throw new Error('Use the local dual app or its Vercel deployment.');
}
const browser = await chromium.launch({ channel: process.env.CERUM_BROWSER_CHANNEL || 'msedge', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const shots = new URL('../../.cache/ai-browser/', import.meta.url);
await mkdir(shots, { recursive: true });
const report = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('cerum.genre-scope.v1', 'nearby');
      window.__cerumTestAnalysers = [];
      const proto = window.AudioContext?.prototype;
      if (proto) {
        const original = proto.createAnalyser;
        proto.createAnalyser = function (...args) {
          const analyser = original.apply(this, args);
          window.__cerumTestAnalysers.push(analyser);
          return analyser;
        };
        const originalCompressor = proto.createDynamicsCompressor;
        proto.createDynamicsCompressor = function (...args) {
          const compressor = originalCompressor.apply(this, args);
          const probe = original.call(this);
          compressor.connect(probe);
          probe.connect(this.destination);
          // Keep one output route: the app's subsequent destination connection
          // is redirected to the already connected probe during this test only.
          const connect = compressor.connect.bind(compressor);
          compressor.connect = (destination, ...rest) => destination === this.destination ? probe : connect(destination, ...rest);
          window.__cerumTestAnalysers.push(probe);
          return compressor;
        };
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start a mix', exact: true }).click();
    await page.locator('.recommendation-card').nth(11).waitFor({ timeout: 60000 });
    await page.locator('.intelligence-status').getByText(/Your preview is AI-indexed/).waitFor();
    const close = page.getByRole('button', { name: 'Close full-screen visuals', exact: true });
    await close.waitFor();
    await close.click();
    await page.waitForFunction(() => !document.querySelector('.fullscreen-visualizer'));
    const player = page.locator('.mix-player');
    await page.waitForFunction(() => Number(document.querySelector('.mix-player input[aria-label="Preview position"]')?.value) > 1.5, { timeout: 30000 });
    const position = () => page.locator('.mix-player input[aria-label="Preview position"]').inputValue().then(Number);
    const beforeFeedback = await position();
    const firstCard = page.locator('.recommendation-card').first();
    const rejected = await firstCard.locator('h3').innerText();
    await firstCard.getByRole('button', { name: /^Too different:/ }).click();
    await page.getByText(/Keeping closer to your starting song/).waitFor();
    await page.waitForFunction(() => document.querySelector('.recommendation-feedback button:not(:disabled)'));
    assert.equal(await player.getAttribute('data-active-index'), '0');
    assert.ok(await position() >= beforeFeedback - .2, 'Feedback does not rewind the playing song');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cerum.feedback.v1:guest') || '[]'));
    assert.equal(saved[0]?.reason, 'too_different');
    await page.locator('.recommendation-card').first().getByRole('button', { name: /^More like this:/ }).click();
    await page.getByText(/More of this sound/).waitFor();
    await page.getByRole('button', { name: 'Pause AutoMix', exact: true }).click();
    const paused = await position();
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await position() - paused) < .3);
    await page.getByRole('button', { name: 'Play AutoMix', exact: true }).click();
    await page.waitForFunction((previous) => Number(document.querySelector('.mix-player input[aria-label="Preview position"]')?.value) > previous + .3, paused);
    const audioRms = await page.evaluate(() => Math.max(0, ...window.__cerumTestAnalysers.map((analyser) => {
      const buffer = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buffer);
      return Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
    })));
    assert.ok(audioRms > .001, 'The audio graph contains a non-silent signal');
    await page.getByRole('button', { name: 'Next song', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('.mix-player')?.dataset.activeIndex) > 0);
    await page.waitForFunction(() => document.querySelector('.mix-player')?.dataset.playing === 'true');
    if (!mobile) {
      // Seek inside the preview, then observe a real automatic overlap and advancement.
      const indexBefore = Number(await player.getAttribute('data-active-index'));
      await page.locator('.mix-player input[aria-label="Preview position"]').evaluate((element) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(element, '23');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.mix-player audio')).filter((audio) => !audio.paused && audio.currentTime > 0).length >= 2,
        undefined, { timeout: 25000, polling: 50 });
      await page.waitForFunction((index) => Number(document.querySelector('.mix-player')?.dataset.activeIndex) > index,
        indexBefore, { timeout: 10000 });
      assert.equal(await player.getAttribute('data-playing'), 'true');
    }
    assert.ok(await page.locator('.ai-match-tag').count() > 0, 'At least one suggestion has a real learned match');
    await page.locator('.intelligence-status').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL(`${mobile ? 'mobile' : 'desktop'}.png`, shots).pathname.replace(/^\/(.:\/)/, '$1'), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    assert.equal(overflow, false, 'Page has no horizontal overflow');
    assert.deepEqual(errors, []);
    report.push({ browser: `Chromium / ${process.env.CERUM_BROWSER_CHANNEL || 'msedge'} ${browser.version()}`, viewport: mobile ? '390×844 phone emulation' : '1440×1000 desktop', rejected,
      audioRms: Number(audioRms.toFixed(5)), feedback: 'persisted and reranked without playback reset',
      pauseResume: 'position preserved', manualSkip: 'playing',
      automaticTransition: mobile ? 'covered on desktop run' : 'two playing audio elements observed during overlap; advanced automatically', errors });
    await context.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
