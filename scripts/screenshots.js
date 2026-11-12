/**
 * Optional visual QA helper. Requires `npx playwright install chromium`.
 * Usage: node scripts/screenshots.js [baseUrl] [outDir]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const out = process.argv[3] || 'artifacts';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];

async function capture(name, url, { role, viewport = { width: 1440, height: 960 }, fullPage = true, prefill } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (role) {
    const res = await context.request.post(`${base}/api/auth/login`, {
      data: { email: `${role}@affilink.demo`, password: role === 'admin' ? 'Admin123!' : role === 'brand' ? 'Brand123!' : 'Creator123!' },
    });
    if (!res.ok()) throw new Error(`login failed for ${role}`);
  }
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name} console: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => errors.push(`${name} failed: ${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`${name} ${res.status()}: ${res.url()}`);
  });
  await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (prefill) await prefill(page);
  // Walk down the page so ScrollTrigger reveals fire before a full-page capture.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  // Freeze entrance animations in their finished state so a stitched full-page
  // capture never catches a revealed section mid-tween.
  await page.addStyleTag({
    content:
      '[data-reveal],[data-reveal-group] > *{opacity:1!important;transform:none!important}' +
      '.site-header{position:static!important}',
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
  await browser.contexts()[0]?.close?.();
  await context.close();
}

await capture('home-desktop', '/');
await capture('home-full', '/', { fullPage: true });
await capture('programs', '/programs');
await capture('program-detail', '/programs/amazon-associates');
await capture('login', '/login', { fullPage: false });
await capture('creator-dashboard', '/dashboard', { role: 'creator' });
await capture('creator-links', '/dashboard?links', { role: 'creator', fullPage: false });
await capture('brand-dashboard', '/brand/dashboard', { role: 'brand' });
await capture('admin', '/admin', { role: 'admin' });
await capture('home-mobile', '/', { viewport: { width: 390, height: 844 } });
await capture('programs-mobile', '/programs', { viewport: { width: 390, height: 844 } });

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Screenshots captured with no page errors.');
}
