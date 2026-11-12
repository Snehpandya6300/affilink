import { chromium } from 'playwright-core';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await p.goto('http://127.0.0.1:3000/programs', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const info = await p.evaluate(() => {
  const panel = document.querySelector('.filters-panel');
  const sort = document.getElementById('sortSelect');
  const tb = document.querySelector('.toolbar-right');
  const header = document.querySelector('.header-actions');
  return {
    panelClass: panel.className,
    panelRect: panel.getBoundingClientRect().toJSON(),
    panelDisplay: getComputedStyle(panel).display,
    sortRect: sort.getBoundingClientRect().toJSON(),
    toolbarRect: tb.getBoundingClientRect().toJSON(),
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
    header: header.innerText.replace(/\n/g, ' | '),
  };
});
console.log(JSON.stringify(info, null, 1));
await p.screenshot({ path: 'artifacts/mobile-programs-top.png' });
await p.click('[data-open-filters]');
await p.waitForTimeout(500);
await p.screenshot({ path: 'artifacts/mobile-filters.png' });
await p.click('.nav-toggle');
await p.waitForTimeout(400);
await p.screenshot({ path: 'artifacts/mobile-nav.png' });
await b.close();
