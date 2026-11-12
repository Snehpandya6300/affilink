/**
 * Client-side runtime check: loads each page in jsdom, executes its real ES modules
 * against the running dev server, and asserts that dynamic UI rendered without errors.
 *
 * Usage: node scripts/ui-check.js [baseUrl]
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;

const ACCOUNTS = {
  creator: { email: 'creator@affilink.demo', password: 'Creator123!' },
  brand: { email: 'brand@affilink.demo', password: 'Brand123!' },
  admin: { email: 'admin@affilink.demo', password: 'Admin123!' },
};

const pages = [
  {
    name: 'Homepage',
    url: '/',
    script: 'home.js',
    wait: 900,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['featured cards rendered', d.querySelectorAll('[data-featured-programs] .program-card').length >= 4],
        ['category tiles rendered', d.querySelectorAll('[data-category-grid] .category-tile').length === 8],
        ['testimonials rendered', d.querySelectorAll('[data-testimonials] .testimonial').length >= 3],
        ['trending programs rendered', d.querySelectorAll('[data-trending-programs] .program-card').length >= 3],
        ['hero stats filled', d.querySelector('[data-stat="programs"]').textContent.trim() !== '—'],
      ];
    },
  },
  {
    name: 'Directory',
    url: '/programs',
    script: 'programs.js',
    wait: 900,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['results rendered', d.querySelectorAll('#results .program-card').length === 9],
        ['result count filled', /Showing/.test(d.getElementById('resultsCount').textContent)],
        ['pagination rendered', d.querySelectorAll('#pagination button').length > 2],
        ['category filters populated', d.querySelectorAll('#categoryFilters input').length >= 9],
        ['network filter populated', d.querySelectorAll('#networkFilter option').length > 1],
      ];
    },
  },
  {
    name: 'Program detail',
    url: '/programs/semrush',
    script: 'program-details.js',
    wait: 900,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['detail heading rendered', /Semrush/.test(d.querySelector('#detailRoot h1')?.textContent || '')],
        ['apply button present', Boolean(d.querySelector('.apply-card [data-apply]'))],
        ['spec values rendered', d.querySelectorAll('.spec-value').length >= 8],
        ['similar programs rendered', d.querySelectorAll('.similar-grid .program-card').length >= 1],
      ];
    },
  },
  {
    name: 'Categories page',
    url: '/categories',
    script: 'categories.js',
    wait: 700,
    assert(dom) {
      const d = dom.window.document;
      return [['category tiles rendered', d.querySelectorAll('#categoryGrid .category-tile').length === 8]];
    },
  },
  {
    name: 'Login page',
    url: '/login',
    script: 'auth-page.js',
    wait: 200,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['login form present', Boolean(d.getElementById('loginForm'))],
        ['demo account fillers present', d.querySelectorAll('[data-fill]').length === 3],
      ];
    },
  },
  {
    name: 'Register page',
    url: '/register?role=brand',
    script: 'auth-page.js',
    wait: 200,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['brand role preselected', d.querySelector('input[name="role"][value="brand"]').checked],
        ['company field visible', !d.getElementById('companyField').hidden],
      ];
    },
  },
  {
    name: 'Creator dashboard',
    url: '/dashboard',
    script: 'creator-dashboard.js',
    role: 'creator',
    wait: 1100,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['user name populated', d.querySelector('[data-user-name]').textContent !== 'Loading…'],
        ['saved stat populated', d.querySelector('[data-stat="saved"]').textContent.trim() !== '—'],
        ['recent programs rendered', d.querySelectorAll('[data-recent-programs] .dash-list-item').length > 0],
        ['recommended cards rendered', d.querySelectorAll('[data-recommended] .program-card').length > 0],
      ];
    },
    async interact(dom) {
      const d = dom.window.document;
      d.querySelector('.side-link[data-view="applications"]').click();
      await sleep(700);
      return [
        ['applications view opens', !d.querySelector('[data-view-panel="applications"]').hidden],
        ['applications table rendered', d.querySelectorAll('#applicationsTable tbody tr').length >= 1],
        ['status select rendered', d.querySelectorAll('[data-app-status]').length >= 1],
      ];
    },
  },
  {
    name: 'Creator affiliate links',
    url: '/dashboard?links',
    script: 'creator-dashboard.js',
    role: 'creator',
    wait: 1200,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['links panel opens', !d.querySelector('[data-view-panel="links"]').hidden],
        ['seeded links rendered', d.querySelectorAll('[data-offer-list] .offer-item').length === 2],
        ['short share link shown', /\/go\/mayas-/.test(d.querySelector('[data-offer-list] .offer-link')?.textContent || '')],
        ['preset buttons rendered', d.querySelectorAll('[data-preset]').length >= 5],
        ['link count badge filled', d.querySelector('[data-count-offers]').textContent.trim() === '2'],
      ];
    },
    async interact(dom) {
      const d = dom.window.document;
      d.querySelector('[data-preset="Amazon Associates"]').click();
      const brandFilled = d.getElementById('offerBrand').value === 'Amazon Associates' && d.getElementById('offerCategory').value === 'ecommerce';
      d.querySelector('[data-offer-list] [data-action="edit"]').click();
      await sleep(150);
      return [
        ['preset fills brand and category', brandFilled],
        ['edit loads the form', d.getElementById('offerForm').elements.title.value.length > 0 && !d.querySelector('[data-offer-cancel]').hidden],
      ];
    },
  },
  {
    name: 'Brand dashboard',
    url: '/brand/dashboard',
    script: 'brand-dashboard.js',
    role: 'brand',
    wait: 1100,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['brand stats populated', d.querySelector('[data-stat="total"]').textContent.trim() !== '—'],
        ['overview chart rendered', d.querySelectorAll('#overviewChart svg').length === 1],
        ['programs preview rendered', d.querySelectorAll('#programsPreview .dash-list-item').length >= 1],
        ['reviews panel rendered', d.querySelector('#brandReviews') !== null && d.querySelector('#brandReviews').textContent.trim().length > 0],
      ];
    },
    async interact(dom) {
      const d = dom.window.document;
      d.querySelector('.side-link[data-view="analytics"]').click();
      await sleep(900);
      return [
        ['analytics view opens', !d.querySelector('[data-view-panel="analytics"]').hidden],
        ['program selector populated', d.querySelectorAll('#analyticsProgram option').length >= 1],
        ['analytics chart rendered', d.querySelectorAll('#analyticsChart svg').length === 1],
      ];
    },
  },
  {
    name: 'Add program form',
    url: '/brand/programs/new',
    script: 'program-form.js',
    role: 'brand',
    wait: 900,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['category options loaded', d.querySelectorAll('#category option').length >= 9],
        ['preview card present', Boolean(d.querySelector('.program-preview-card'))],
        ['brand name populated in sidebar', d.querySelector('[data-user-name]').textContent !== 'Brand account'],
      ];
    },
    async interact(dom) {
      const d = dom.window.document;
      const form = d.getElementById('programForm');
      form.elements.brandName.value = 'Preview Brand';
      form.elements.brandName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await sleep(120);
      return [['live preview updates', d.getElementById('previewBrand').textContent === 'Preview Brand']];
    },
  },
  {
    name: 'Admin dashboard',
    url: '/admin',
    script: 'admin-dashboard.js',
    role: 'admin',
    wait: 1200,
    assert(dom) {
      const d = dom.window.document;
      return [
        ['admin stats populated', d.querySelector('[data-count="users"]').textContent !== '—'],
        ['pending preview rendered', d.querySelector('#pendingPreview').textContent.trim().length > 0],
        ['top programs rendered', d.querySelectorAll('#topPrograms tbody tr').length >= 1],
        ['overview chart rendered', d.querySelectorAll('#overviewChart svg').length === 1],
      ];
    },
    async interact(dom) {
      const d = dom.window.document;
      d.querySelector('.side-link[data-view="programs"]').click();
      await sleep(800);
      const rows = d.querySelectorAll('#adminPrograms tbody tr').length;
      d.querySelector('.side-link[data-view="analytics"]').click();
      await sleep(800);
      return [
        ['program table rendered', rows >= 1],
        ['analytics view opens', !d.querySelector('[data-view-panel="analytics"]').hidden],
        ['traffic chart rendered', d.querySelectorAll('#trafficChart svg').length === 1],
        ['category table rendered', d.querySelectorAll('#topCategories tbody tr').length >= 8],
      ];
    },
  },
];

async function login(role) {
  const account = ACCOUNTS[role];
  const res = await realFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!res.ok) throw new Error(`Login failed for ${role}`);
  const cookies = res.headers.getSetCookie?.() || [];
  const session = cookies.find((c) => c.startsWith('affilink_session='));
  return session ? session.split(';')[0] : '';
}

async function runPage(page) {
  const errors = [];
  const cookie = page.role ? await login(page.role) : '';
  const html = await (await realFetch(`${base}${page.url}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' })).text();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Not implemented/.test(err.message)) errors.push(`jsdomError: ${err.message}`);
  });
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));
  const dom = new JSDOM(html, {
    url: `${base}${page.url}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  // Minimal browser surface used by the app, backed by the real server.
  global.window = window;
  global.document = window.document;
  Object.defineProperty(global, 'location', { value: window.location, configurable: true });
  global.history = window.history;
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  global.CustomEvent = window.CustomEvent;
  global.Event = window.Event;
  global.Node = window.Node;
  global.HTMLElement = window.HTMLElement;
  global.CSS = { escape: (value) => String(value).replace(/["\\]/g, '\\$&') };
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  window.scrollTo = () => {};
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  global.fetch = (input, init = {}) => {
    const url = new URL(String(input), `${base}${page.url}`).toString();
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    return realFetch(url, { ...init, headers, redirect: 'manual' });
  };
  window.fetch = global.fetch;

  const errorHandler = (event) => errors.push(`uncaught: ${event.message || event.reason}`);
  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${e.reason}`));
  process.on('unhandledRejection', (reason) => errors.push(`process unhandled: ${reason}`));

  await import(`${pathToFileURL(path.join(root, 'assets', 'js', page.script)).href}?page=${encodeURIComponent(page.name)}`);
  await sleep(page.wait);

  const checks = page.assert(dom);
  if (page.interact) checks.push(...(await page.interact(dom)));
  await sleep(150);

  dom.window.close();
  return { checks, errors };
}

let failures = 0;
const lines = [];

if (process.env.UI_PAGE) {
  // Child mode: a fresh process per page so ES-module singletons don't leak between pages.
  const page = pages.find((p) => p.name === process.env.UI_PAGE);
  if (!page) {
    console.error(`Unknown page: ${process.env.UI_PAGE}`);
    process.exit(1);
  }
  const { checks, errors } = await runPage(page);
  const bad = checks.filter(([, ok]) => !ok).length;
  failures = bad + errors.length;
  lines.push(`${failures === 0 ? '✓' : '✗'} ${page.name}`);
  checks.forEach(([label, ok]) => lines.push(`    ${ok ? '✓' : '✗'} ${label}`));
  errors.slice(0, 6).forEach((e) => lines.push(`    ! ${e}`));
  console.log(lines.join('\n'));
  process.exit(failures ? 1 : 0);
} else {
  const { spawnSync } = await import('node:child_process');
  for (const page of pages) {
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), base], {
      env: { ...process.env, UI_PAGE: page.name },
      encoding: 'utf8',
    });
    const output = `${res.stdout || ''}${res.stderr || ''}`.trimEnd();
    if (res.status !== 0) failures += 1;
    console.log(output);
  }
  console.log(`\n${failures === 0 ? 'All UI checks passed.' : `${failures} page(s) with UI issues.`}`);
  process.exit(failures ? 1 : 0);
}
