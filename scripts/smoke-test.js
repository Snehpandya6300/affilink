/**
 * End-to-end smoke test against a throwaway database.
 * Boots the real server on port 3100, exercises the HTTP API with cookie sessions,
 * then shuts down and removes the temporary database.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'data', 'smoke-test.db');
const port = 3100;
const base = `http://127.0.0.1:${port}`;
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.push(`  ✓ ${name}`);
  } else {
    failures += 1;
    results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not start in time');
}

function jar() {
  return {
    cookie: '',
    store(res) {
      const setCookie = res.headers.getSetCookie?.() || [];
      for (const c of setCookie) {
        const pair = c.split(';')[0];
        if (pair.startsWith('affilink_session=')) this.cookie = pair;
      }
    },
    async request(method, url, body) {
      const headers = {};
      if (this.cookie) headers.cookie = this.cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(`${base}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      this.store(res);
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
}

const stamp = Date.now();
const creatorEmail = `smoke.creator.${stamp}@example.com`;
const brandEmail = `smoke.brand.${stamp}@example.com`;
const creator = jar();
const brand = jar();
const admin = jar();

let createdProgramId = null;
let createdSlug = null;

async function main() {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForServer();

    /* ---------------- public directory */
    let res = await fetch(`${base}/api/programs?perPage=3`);
    let data = await res.json();
    check('directory lists approved programs', res.status === 200 && data.items.length === 3 && data.total >= 30, `total=${data.total}`);
    check('facets include categories, networks, payments', data.facets.categories.length === 8 && data.facets.networks.length > 0 && data.facets.paymentMethods.length > 0);

    res = await fetch(`${base}/api/programs?category=saas&commissionType=recurring&sort=commission&minCommission=15`);
    data = await res.json();
    check('combined filters work', data.items.length > 0 && data.items.every((p) => p.category.slug === 'saas' && p.commissionType === 'recurring' && p.commissionValue >= 15), JSON.stringify(data.items.map((p) => p.slug)));

    res = await fetch(`${base}/api/programs?q=semrush`);
    data = await res.json();
    check('search matches brand name', data.items.some((p) => p.brandName === 'Semrush'));

    res = await fetch(`${base}/api/programs?cookie=90`);
    data = await res.json();
    check('cookie filter works', data.items.length > 0 && data.items.every((p) => p.cookieDays >= 90));

    res = await fetch(`${base}/api/programs?page=2&perPage=9`);
    data = await res.json();
    check('pagination returns page 2', data.page === 2 && data.items.length === 9 && data.totalPages > 1);

    res = await fetch(`${base}/api/programs/semrush`);
    data = await res.json();
    check('program detail loads by slug', res.status === 200 && data.program.slug === 'semrush' && data.program.commissionLabel.length > 0);
    check('detail includes similar programs', data.program.similar.length > 0);

    res = await fetch(`${base}/api/programs/does-not-exist`);
    check('unknown program returns 404', res.status === 404);

    const beforeViews = data?.program?.viewCount;
    void beforeViews;

    res = await fetch(`${base}/api/programs/framer`);
    data = await res.json();
    const framerViewBefore = data.program.viewCount;
    await fetch(`${base}/api/programs/framer/view`, { method: 'POST', headers: { 'user-agent': `smoke-${stamp}` } });
    res = await fetch(`${base}/api/programs/framer`);
    data = await res.json();
    check('view tracking increments views', data.program.viewCount === framerViewBefore + 1, `${framerViewBefore} → ${data.program.viewCount}`);

    const clicksBefore = data.program.clickCount;
    res = await fetch(`${base}/api/programs/framer/click`, { method: 'POST' });
    check('click endpoint returns signup URL', res.status === 200 && (await res.json()).url.startsWith('http'));
    res = await fetch(`${base}/api/programs/framer`);
    data = await res.json();
    check('click tracking increments clicks', data.program.clickCount === clicksBefore + 1);

    /* ---------------- auth */
    res = await creator.request('POST', '/api/auth/register', { name: 'Smoke Creator', email: creatorEmail, password: 'SmokeTest123', role: 'creator' });
    check('creator registration succeeds', res.status === 201 && res.data.user.email === creatorEmail, JSON.stringify(res.data));
    check('registration sets session cookie', Boolean(creator.cookie));

    res = await creator.request('POST', '/api/auth/register', { name: 'Dupe', email: creatorEmail, password: 'SmokeTest123', role: 'creator' });
    check('duplicate email rejected', res.status === 409);

    res = await creator.request('POST', '/api/auth/register', { name: 'x', email: 'not-an-email', password: 'short', role: 'creator' });
    check('invalid registration rejected with field errors', res.status === 400 && res.data.fields.email && res.data.fields.password);

    res = await creator.request('GET', '/api/auth/me');
    check('session resolves current user', res.status === 200 && res.data.user.email === creatorEmail);

    res = await creator.request('POST', '/api/programs/semrush/reviews', { rating: 5, body: 'Smoke test review with enough characters.' });
    check('creator can submit a review', res.status === 201);

    /* ---------------- saved programs */
    const semrushId = (await (await fetch(`${base}/api/programs/semrush`)).json()).program.id;
    res = await creator.request('POST', `/api/creator/saved/${semrushId}`);
    check('save program succeeds', res.status === 201 && res.data.saved === true);
    res = await creator.request('GET', '/api/creator/saved');
    check('saved program persists', res.status === 200 && res.data.items.some((p) => p.id === semrushId));
    res = await fetch(`${base}/api/programs?q=semrush`, { headers: { cookie: creator.cookie } });
    check('saved state reflected in directory for signed-in user', (await res.json()).items[0].saved === true);
    res = await creator.request('DELETE', `/api/creator/saved/${semrushId}`);
    check('unsave program succeeds', res.status === 200 && res.data.saved === false);
    res = await creator.request('POST', `/api/creator/saved/${semrushId}`);

    /* ---------------- applications */
    res = await creator.request('POST', '/api/creator/applications', { programId: semrushId });
    check('track application succeeds', res.status === 201 && res.data.signupUrl.startsWith('http'));
    const appId = res.data.id;
    res = await creator.request('POST', '/api/creator/applications', { programId: semrushId });
    check('duplicate application rejected', res.status === 409);
    res = await creator.request('PATCH', `/api/creator/applications/${appId}`, { status: 'approved', notes: 'Approved in smoke test' });
    check('application status update succeeds', res.status === 200);
    res = await creator.request('GET', '/api/creator/applications');
    check('application status persisted', res.data.items[0].status === 'approved' && res.data.items[0].notes === 'Approved in smoke test');

    res = await creator.request('PUT', '/api/creator/profile', {
      name: 'Smoke Creator',
      website: 'https://smoke.example.com',
      niche: 'SaaS',
      audienceSize: '10,000',
      country: 'Germany',
      promoMethods: ['Newsletter', 'YouTube'],
      bio: 'Testing the creator profile.',
    });
    check('creator profile saves', res.status === 200);
    res = await creator.request('GET', '/api/creator/profile');
    check('creator profile persists', res.data.profile.website === 'https://smoke.example.com' && res.data.profile.promoMethods.includes('YouTube'));
    res = await creator.request('GET', '/api/creator/overview');
    check('creator overview returns stats', res.status === 200 && res.data.stats.saved >= 1 && res.data.saved.length >= 1);

    res = await creator.request('GET', '/api/admin/overview');
    check('creator blocked from admin API', res.status === 403);
    res = await creator.request('GET', '/api/brand/overview');
    check('creator blocked from brand API', res.status === 403);

    /* ---------------- brand flow */
    res = await brand.request('POST', '/api/auth/register', {
      name: 'Smoke Brand',
      email: brandEmail,
      password: 'SmokeTest123',
      role: 'brand',
      companyName: 'Smoke Labs',
    });
    check('brand registration succeeds', res.status === 201 && res.data.redirect === '/brand/dashboard');

    const programPayload = {
      brandName: 'Smoke Labs',
      title: 'Smoke Labs Affiliate Program',
      description: 'A smoke-test affiliate program used to verify the submission and approval workflow end to end.',
      category: 'saas',
      websiteUrl: 'https://smoke-labs.example.com',
      signupUrl: 'https://smoke-labs.example.com/affiliates',
      commissionType: 'recurring',
      commissionValue: 25,
      cookieDays: 60,
      minPayout: 50,
      paymentFrequency: 'Monthly',
      network: 'PartnerStack',
      eligibleCountries: 'Worldwide',
      requirements: 'Active audience and brand-safe content.',
      contactEmail: brandEmail,
      paymentMethods: ['PayPal', 'Bank transfer'],
      promoMethods: ['Content / blog', 'Newsletter'],
    };

    res = await brand.request('POST', '/api/brand/programs', programPayload);
    check('brand submits program', res.status === 201 && res.data.slug, JSON.stringify(res.data));
    createdProgramId = res.data.id;
    createdSlug = res.data.slug;
    check('submitted slug is generated', Boolean(createdSlug) && /^[a-z0-9-]+$/.test(createdSlug), createdSlug);

    res = await fetch(`${base}/api/programs/${createdSlug}`);
    check('pending program is not public', res.status === 404);

    res = await brand.request('POST', '/api/brand/programs', { ...programPayload, title: 'Bad', description: 'short', websiteUrl: 'nope' });
    check('invalid submission rejected', res.status === 400 && Object.keys(res.data.fields || {}).length >= 3, `${res.status} ${JSON.stringify(res.data)}`);

    res = await brand.request('GET', '/api/brand/programs');
    check('brand sees its own pending program', res.data.items.some((p) => p.id === createdProgramId && p.status === 'pending'));

    res = await brand.request('PUT', `/api/brand/programs/${createdProgramId}`, { ...programPayload, commissionLabel: '25% recurring for 24 months' });
    check('brand edits program', res.status === 200);
    res = await brand.request('GET', `/api/brand/programs/${createdProgramId}`);
    check('edit persisted', res.data.program.commissionLabel === '25% recurring for 24 months' && res.data.program.status === 'pending');

    res = await brand.request('GET', '/api/brand/overview');
    check('brand overview returns its programs', res.status === 200 && res.data.programs.length === 1);
    res = await brand.request('GET', `/api/brand/programs/${createdProgramId}/analytics`);
    check('brand analytics endpoint works', res.status === 200 && Array.isArray(res.data.series) && res.data.series.length === 30);

    res = await brand.request('PUT', '/api/brand/profile', { name: 'Smoke Brand', companyName: 'Smoke Labs', contactEmail: brandEmail, website: 'https://smoke-labs.example.com' });
    check('brand profile saves', res.status === 200);

    /* ---------------- creator-owned affiliate links */
    res = await creator.request('GET', '/api/creator/offers');
    check('new creator starts with no affiliate links', res.status === 200 && Array.isArray(res.data.items) && res.data.items.length === 0, JSON.stringify(res.data.stats));

    res = await creator.request('POST', '/api/creator/offers', { brandName: 'Amazon Associates', title: 'Smoke test gear list', destinationUrl: 'https://www.amazon.com/dp/B000?tag=smoke-20', category: 'ecommerce', commissionNote: 'Up to 10% per item' });
    check('creator creates an affiliate link', res.status === 201 && res.data.offer.slug && res.data.offer.shareUrl === `/go/${res.data.offer.slug}`, JSON.stringify(res.data));
    const offerSlug = res.data.offer.slug;
    const offerId = res.data.offer.id;

    res = await creator.request('POST', '/api/creator/offers', { brandName: 'X', title: 'Bad', destinationUrl: 'javascript:alert(1)' });
    check('invalid affiliate destination rejected', res.status === 400 && res.data.fields.destinationUrl);

    const beforeRedirect = await (await fetch(`${base}/api/creator/offers`, { headers: { cookie: creator.cookie } })).json();
    const offerClicksBefore = beforeRedirect.items.find((o) => o.id === offerId).clicks;
    const redirectRes = await fetch(`${base}/go/${offerSlug}`, { redirect: 'manual' });
    check('affiliate short link redirects to the creator URL', redirectRes.status === 302 && redirectRes.headers.get('location') === 'https://www.amazon.com/dp/B000?tag=smoke-20', `${redirectRes.status} ${redirectRes.headers.get('location')}`);
    const afterRedirect = await (await fetch(`${base}/api/creator/offers`, { headers: { cookie: creator.cookie } })).json();
    check('affiliate short link counts the click', afterRedirect.items.find((o) => o.id === offerId).clicks === offerClicksBefore + 1);

    res = await creator.request('PUT', `/api/creator/offers/${offerId}`, { title: 'Smoke test gear list v2' });
    check('creator updates an affiliate link', res.status === 200 && res.data.offer.title === 'Smoke test gear list v2');

    res = await creator.request('PUT', `/api/creator/offers/${offerId}`, { isActive: false });
    check('creator can pause an affiliate link', res.status === 200 && res.data.offer.isActive === false);
    const paused = await fetch(`${base}/go/${offerSlug}`, { redirect: 'manual' });
    check('paused affiliate link stops redirecting', paused.status === 404, String(paused.status));
    await creator.request('PUT', `/api/creator/offers/${offerId}`, { isActive: true });

    const other = jar();
    const otherEmail = `other-${stamp}@example.com`;
    await other.request('POST', '/api/auth/register', { name: 'Other Creator', email: otherEmail, password: 'Creator123!', confirmPassword: 'Creator123!', role: 'creator' });
    res = await other.request('GET', '/api/creator/offers');
    check('affiliate links are private to their owner', res.status === 200 && res.data.items.length === 0);
    res = await other.request('PUT', `/api/creator/offers/${offerId}`, { title: 'Hijacked link title' });
    check('another creator cannot edit the link', res.status === 404);

    res = await creator.request('DELETE', `/api/creator/offers/${offerId}`);
    check('creator deletes an affiliate link', res.status === 200);
    const gone = await fetch(`${base}/go/${offerSlug}`, { redirect: 'manual' });
    check('deleted affiliate link no longer resolves', gone.status === 404);

    const brandOffer = await brand.request('POST', '/api/creator/offers', { brandName: 'Nope', title: 'Brand link attempt', destinationUrl: 'https://example.com' });
    check('brands cannot create creator links', brandOffer.status === 403);

    /* ---------------- admin */
    res = await admin.request('POST', '/api/auth/login', { email: 'admin@affilink.demo', password: 'Admin123!' });
    check('seeded admin login succeeds', res.status === 200 && res.data.redirect === '/admin');

    res = await admin.request('GET', '/api/admin/overview');
    check('admin overview loads', res.status === 200 && res.data.counts.pending >= 1);

    res = await admin.request('GET', '/api/admin/programs?status=pending');
    check('admin sees pending submissions', res.status === 200 && res.data.items.some((p) => p.id === createdProgramId));

    res = await admin.request('PATCH', `/api/admin/programs/${createdProgramId}`, { status: 'rejected' });
    check('reject requires a reason', res.status === 400);

    res = await admin.request('PATCH', `/api/admin/programs/${createdProgramId}`, { status: 'approved', featured: true });
    check('admin approves program', res.status === 200);

    res = await fetch(`${base}/api/programs/${createdSlug}`);
    check('approved program becomes public', res.status === 200);
    res = await fetch(`${base}/sitemap.xml`);
    const sitemap = await res.text();
    check('approved program appears in sitemap', sitemap.includes(`/programs/${createdSlug}`));

    res = await admin.request('PATCH', `/api/admin/programs/${createdProgramId}`, { title: 'Smoke Labs Partner Program', description: 'Updated description for the smoke-test affiliate program used to verify moderation flows.' });
    check('admin edits listing fields', res.status === 200);
    res = await fetch(`${base}/api/programs/${createdSlug}`);
    check('admin edit is visible publicly', (await res.json()).program.title === 'Smoke Labs Partner Program');

    res = await admin.request('GET', '/api/admin/reviews?status=pending');
    check('admin sees pending review', res.status === 200 && res.data.items.length >= 1);
    const reviewId = res.data.items[0].id;
    res = await admin.request('PATCH', `/api/admin/reviews/${reviewId}`, { status: 'approved' });
    check('admin approves review', res.status === 200);
    res = await fetch(`${base}/api/programs/semrush`);
    check('approved review appears on program page', (await res.json()).program.reviews.some((r) => r.id === reviewId));

    res = await admin.request('GET', '/api/admin/users');
    check('admin lists users', res.status === 200 && res.data.items.length >= 3);
    const creatorRow = res.data.items.find((u) => u.email === creatorEmail);
    res = await admin.request('PATCH', `/api/admin/users/${creatorRow.id}`, { status: 'suspended' });
    check('admin suspends user', res.status === 200);
    res = await fetch(`${base}/api/auth/me`, { headers: { cookie: creator.cookie } });
    check('suspended user session is revoked', (await res.json()).user === null);
    res = await admin.request('PATCH', `/api/admin/users/${creatorRow.id}`, { status: 'active' });
    check('admin reactivates user', res.status === 200);

    res = await admin.request('POST', '/api/admin/categories', { name: 'Smoke Category', description: 'Temp', icon: 'bi-box', accent: '#123456' });
    check('admin creates category', res.status === 201);
    const catId = res.data.id;
    res = await admin.request('PUT', `/api/admin/categories/${catId}`, { name: 'Smoke Category Renamed' });
    check('admin updates category', res.status === 200);
    res = await admin.request('DELETE', `/api/admin/categories/${catId}`);
    check('admin deletes empty category', res.status === 200);

    res = await admin.request('POST', '/api/admin/testimonials', { name: 'Test Person', role: 'Tester', quote: 'Smoke test testimonial quote.', rating: 5 });
    check('admin creates testimonial', res.status === 201);
    const tId = res.data.id;
    res = await admin.request('PUT', `/api/admin/testimonials/${tId}`, { status: 'hidden' });
    check('admin hides testimonial', res.status === 200);
    res = await admin.request('DELETE', `/api/admin/testimonials/${tId}`);
    check('admin deletes testimonial', res.status === 200);

    res = await admin.request('GET', '/api/admin/content');
    check('admin content loads', res.status === 200 && res.data.content.hero_title.length > 0);
    res = await admin.request('PUT', '/api/admin/content', { hero_title: 'Smoke Hero Title' });
    check('admin updates content', res.status === 200);
    res = await fetch(`${base}/api/content`);
    check('content change is public', (await res.json()).content.hero_title === 'Smoke Hero Title');
    await admin.request('PUT', '/api/admin/content', { hero_title: 'Find Affiliate Programs Worth Promoting.' });

    res = await admin.request('GET', '/api/admin/analytics');
    check('admin analytics loads', res.status === 200 && res.data.views.length === 30 && res.data.topCategories.length >= 8);

    /* ---------------- contact */
    res = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Visitor', email: `visitor.${stamp}@example.com`, topic: 'My account', message: 'This is a smoke test message body.' }),
    });
    check('contact form accepts message', res.status === 201);
    res = await admin.request('GET', '/api/admin/messages');
    check('admin sees contact message', res.status === 200 && res.data.items.length >= 1);

    /* ---------------- security */
    res = await fetch(`${base}/api/creator/saved`, { method: 'POST' });
    check('unauthenticated mutation rejected', res.status === 401);
    res = await fetch(`${base}/api/programs`, {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: '{}',
    });
    check('cross-origin mutation blocked', res.status === 403);

    res = await fetch(`${base}/dashboard`, { redirect: 'manual' });
    check('protected page redirects guests', res.status === 302 && res.headers.get('location').startsWith('/login'));

    res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creatorEmail, password: 'WrongPassword1' }) });
    check('wrong password rejected', res.status === 401);

    /* ---------------- password reset */
    res = await fetch(`${base}/api/auth/forgot-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creatorEmail }) });
    const reset = await res.json();
    check('forgot password returns demo reset link', res.status === 200 && Boolean(reset.demoResetUrl));
    const token = new URL(reset.demoResetUrl, 'http://x').searchParams.get('token');
    res = await fetch(`${base}/api/auth/reset-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'NewSmokePass123' }) });
    check('password reset succeeds', res.status === 200);
    res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creatorEmail, password: 'NewSmokePass123' }) });
    check('login works with new password', res.status === 200);
    res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creatorEmail, password: 'SmokeTest123' }) });
    check('old password no longer works', res.status === 401);

    /* ---------------- pages render */
    for (const [label, url] of [
      ['homepage', '/'],
      ['directory', '/programs'],
      ['program detail', '/programs/semrush'],
      ['categories', '/categories'],
      ['for brands', '/for-brands'],
      ['resources', '/resources'],
      ['login', '/login'],
      ['register', '/register'],
      ['about', '/about'],
      ['contact', '/contact'],
      ['privacy', '/privacy'],
      ['terms', '/terms'],
      ['404', '/missing-page'],
    ]) {
      const response = await fetch(`${base}${url}`);
      const html = await response.text();
      const expected = url === '/missing-page' ? 404 : 200;
      check(`${label} renders (${expected})`, response.status === expected && html.includes('Affilink'), `got ${response.status}`);
    }

    const home = await (await fetch(`${base}/`)).text();
    check('homepage includes SEO metadata', home.includes('canonical') && home.includes('og:title') && home.includes('<title>'));
    check('home includes shared header component', home.includes('main-nav') && home.includes('site-footer'));
    const detailPage = await (await fetch(`${base}/programs/semrush`)).text();
    check('detail page has dynamic title and JSON-LD', detailPage.includes('Semrush Affiliate Program') && detailPage.includes('application/ld+json'));

    res = await fetch(`${base}/robots.txt`);
    const robots = await res.text();
    check('robots.txt served with sitemap', res.status === 200 && robots.includes('Sitemap:'));

    res = await brand.request('GET', '/api/creator/saved');
    check('brand blocked from creator API', res.status === 403);
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  }

  console.log('\nAffilink smoke test\n');
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  if (results.length) console.error(results.join('\n'));
  process.exit(1);
});
