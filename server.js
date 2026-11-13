import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser, checkOrigin } from './src/auth.js';
import { seedDatabase } from './src/seed.js';
import { one, many, run } from './src/db.js';
import publicRoutes from './src/routes/public.js';
import authRoutes from './src/routes/auth.js';
import creatorRoutes from './src/routes/creator.js';
import brandRoutes from './src/routes/brand.js';
import adminRoutes from './src/routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Schema + seed run once per instance; every request waits for the database to
// be ready, so a cold start never serves a half-migrated database.
let databaseError = null;
const databaseReady = seedDatabase().catch((err) => {
  databaseError = err;
  console.error('[affilink] database init failed', err);
});

app.use(async (req, res, next) => {
  await databaseReady;
  if (databaseError) return next(databaseError);
  next();
});

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

// Creator-owned affiliate links: tracks the click, then hands the visitor to
// the creator's own affiliate URL. Affilink never rewrites or injects tracking.
app.get('/go/:slug', (req, res, next) => {
  (async () => {
    const slug = /^[a-z0-9-]{1,90}$/.test(req.params.slug) ? req.params.slug : null;
    const offer = slug ? await one('SELECT id, destination_url FROM creator_offers WHERE slug = ? AND is_active = 1', slug) : null;
    if (!offer || !/^https?:\/\//i.test(offer.destination_url)) return next();
    await run('UPDATE creator_offers SET clicks = clicks + 1 WHERE id = ?', offer.id);
    res.set('Cache-Control', 'no-store');
    res.redirect(302, offer.destination_url);
  })().catch(next);
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
      "script-src 'self' https://cdn.jsdelivr.net",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ')
  );
  next();
});

app.use(express.static(path.join(here, 'assets'), { extensions: ['html'], maxAge: '10m' }));
app.use('/components', express.static(path.join(here, 'components'), { maxAge: '10m' }));

app.use(attachUser);
app.use('/api', checkOrigin);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/admin', adminRoutes);
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const siteContent = async () => {
  const rows = await many('SELECT key, value FROM site_content');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

const componentCache = new Map();
function component(name) {
  if (!componentCache.has(name)) {
    componentCache.set(name, fs.readFileSync(path.join(here, 'components', `${name}.html`), 'utf8'));
  }
  return componentCache.get(name);
}

function authArea(user) {
  if (!user) {
    return `<a class="nav-login" href="/login">Login</a>
        <a class="btn btn-ghost btn-sm" href="/register">Sign Up</a>`;
  }
  const href = user.role === 'brand' ? '/brand/dashboard' : user.role === 'admin' ? '/admin' : '/dashboard';
  const label = user.role === 'brand' ? 'Brand dashboard' : user.role === 'admin' ? 'Admin panel' : 'Dashboard';
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
  return `<div class="user-menu">
          <a class="user-chip" href="${href}">
            <span class="avatar avatar-sm">${escapeHtml(initials)}</span>
            <span class="user-chip-name">${escapeHtml(user.name.split(' ')[0])}</span>
          </a>
          <div class="user-dropdown">
            <p class="user-dropdown-head">Signed in as<br><strong>${escapeHtml(user.email)}</strong></p>
            <a href="${href}">${label}</a>
            ${user.role === 'creator' ? '<a href="/dashboard?saved">Saved programs</a><a href="/dashboard?applications">My applications</a><a href="/dashboard?links">My affiliate links</a>' : ''}
            ${user.role === 'brand' ? '<a href="/brand/programs/new">Add a program</a><a href="/brand/dashboard?analytics">Listing analytics</a>' : ''}
            <a href="/" data-logout>Log out</a>
          </div>
        </div>`;
}

function affiliateLinksCta(user, mobile = false) {
  if (!user || user.role !== 'creator') return '';
  return mobile
    ? '<a class="nav-cta nav-cta-secondary" href="/dashboard?links">My Affiliate Links</a>'
    : '<a class="btn btn-ghost btn-sm header-cta" href="/dashboard?links"><i class="bi bi-link-45deg" aria-hidden="true"></i> My Affiliate Links</a>';
}

function brandCta(user, size = 'btn-lg') {
  if (!user) return `<a class="btn btn-primary ${size}" href="/register?role=brand">List Your Affiliate Program</a>`;
  if (user.role === 'brand') return `<a class="btn btn-primary ${size}" href="/brand/programs/new">Add a program</a>`;
  return `<div class="alert alert-info" style="margin:0;text-align:left;max-width:520px">
      <i class="bi bi-info-circle"></i>
      <span>Signed in as a ${user.role}. Listings belong to brand accounts —
      <a href="#" data-logout style="font-weight:600;text-decoration:underline">log out</a> to create a brand account, or
      <a href="/contact" style="font-weight:600;text-decoration:underline">contact us</a> about a managed listing.</span>
    </div>`;
}

function renderPage(res, file, { status = 200, title, description, canonical, ogType = 'website', robots = 'index, follow', extraHead = '', bodyClass = '' } = {}) {
  const full = path.join(here, 'pages', file);
  let html = fs.readFileSync(full, 'utf8');
  const siteUrl = process.env.SITE_URL || `${res.req.protocol}://${res.req.get('host')}`;
  html = html.replace(/<!--\s*include:([\w-]+)\s*-->/g, (_, name) => component(name));
  html = html.replaceAll('{{AUTH_AREA}}', authArea(res.req.user));
  html = html.replaceAll(
    '{{SUBMIT_HREF}}',
    res.req.user?.role === 'brand' ? '/brand/programs/new' : res.req.user ? '/for-brands' : '/register?role=brand'
  );
  html = html.replaceAll('{{AFFILIATE_LINKS_CTA}}', affiliateLinksCta(res.req.user));
  html = html.replaceAll('{{AFFILIATE_LINKS_NAV}}', affiliateLinksCta(res.req.user, true));
  html = html.replaceAll('{{BRAND_CTA}}', brandCta(res.req.user));
  html = html.replaceAll('{{BRAND_CTA_SM}}', brandCta(res.req.user, 'btn-sm'));
  const fullTitle = title ? `${title} · Affilink` : 'Affilink — Find Affiliate Programs Worth Promoting';
  const desc =
    description ||
    'Discover affiliate programs from leading brands. Compare commissions, cookie duration, payout terms and niches, then apply through the official network.';
  const url = `${siteUrl}${canonical || res.req.originalUrl.split('?')[0]}`;
  html = html
    .replaceAll('{{TITLE}}', escapeHtml(fullTitle))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(desc))
    .replaceAll('{{CANONICAL}}', escapeHtml(url))
    .replaceAll('{{OG_TYPE}}', ogType)
    .replaceAll('{{ROBOTS}}', robots)
    .replaceAll('{{OG_IMAGE}}', `${siteUrl}/images/og-cover.svg`)
    .replaceAll('{{EXTRA_HEAD}}', extraHead)
    .replaceAll('{{BODY_CLASS}}', bodyClass)
    .replaceAll('{{SITE_URL}}', siteUrl);
  res.status(status).type('html').send(html);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const requirePage = (roles, loginPath = '/login') => (req, res, next) => {
  if (!req.user) {
    const nextPath = encodeURIComponent(req.originalUrl);
    return res.redirect(`${loginPath}?next=${nextPath}`);
  }
  if (roles && !roles.includes(req.user.role)) {
    const fallback = req.user.role === 'brand' ? '/brand/dashboard' : req.user.role === 'admin' ? '/admin' : '/dashboard';
    return res.redirect(fallback);
  }
  next();
};

const simplePage = (file, options = {}) => (req, res) => renderPage(res, file, options);

app.get('/', (req, res) => renderPage(res, 'index.html', { canonical: '/' }));
app.get('/programs', (req, res) =>
  renderPage(res, 'programs.html', {
    title: 'Affiliate Program Directory',
    description: 'Search and filter affiliate programs by category, commission, cookie duration, network and payment method.',
    canonical: '/programs',
  })
);
app.get('/programs/:slug', (req, res, next) => {
  (async () => {
  const program = req.params.slug.match(/^[a-z0-9-]{1,80}$/)
    ? await one(
        `SELECT p.*, c.name AS category_name FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.slug = ?`,
        req.params.slug
      )
    : null;
  if (!program || program.status !== 'approved') return next();
  const extraHead = `
  <meta property="og:type" content="article">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: program.brand_name,
    description: program.description.slice(0, 200),
    url: program.website_url,
  }).replace(/</g, '\\u003c')}</script>`.trim();
  renderPage(res, 'program-details.html', {
    title: `${program.brand_name} Affiliate Program — ${program.commission_label}`,
    description: program.description.slice(0, 158),
    canonical: `/programs/${program.slug}`,
    extraHead,
    bodyClass: 'page-program-details',
  });
  })().catch(next);
});
app.get('/categories', (req, res) =>
  renderPage(res, 'categories.html', {
    title: 'Browse Affiliate Program Categories',
    description: 'Explore affiliate programs by niche: SaaS, AI tools, finance, ecommerce, hosting, education and more.',
    canonical: '/categories',
  })
);
app.get('/for-brands', (req, res) =>
  renderPage(res, 'for-brands.html', {
    title: 'List Your Affiliate Program',
    description: 'Get your affiliate program discovered by creators, publishers and niche experts actively looking for programs to promote.',
    canonical: '/for-brands',
  })
);
app.get('/resources', (req, res) =>
  renderPage(res, 'resources.html', {
    title: 'Affiliate Marketing Resources',
    description: 'Practical guides on choosing affiliate programs, negotiating commissions and tracking your applications.',
    canonical: '/resources',
  })
);
app.get('/about', (req, res) =>
  renderPage(res, 'about.html', { title: 'About Affilink', description: 'Why we built a cleaner way to discover affiliate programs.', canonical: '/about' })
);
app.get('/contact', (req, res) =>
  renderPage(res, 'contact.html', { title: 'Contact', description: 'Contact the Affilink team about programs, partnerships or your account.', canonical: '/contact' })
);
app.get('/privacy', (req, res) =>
  renderPage(res, 'privacy.html', { title: 'Privacy Policy', description: 'How Affilink handles account, profile and analytics data.', canonical: '/privacy' })
);
app.get('/terms', (req, res) =>
  renderPage(res, 'terms.html', { title: 'Terms & Conditions', description: 'The terms that apply to using the Affilink platform.', canonical: '/terms' })
);

app.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'brand' ? '/brand/dashboard' : req.user.role === 'admin' ? '/admin' : '/dashboard');
  renderPage(res, 'login.html', { title: 'Sign in', description: 'Sign in to save affiliate programs, track applications and manage listings.', canonical: '/login', robots: 'noindex, follow' });
});
app.get('/register', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'brand' ? '/brand/dashboard' : req.user.role === 'admin' ? '/admin' : '/dashboard');
  renderPage(res, 'register.html', { title: 'Create your account', description: 'Join Affilink as a creator looking for programs or a brand listing a program.', canonical: '/register', robots: 'noindex, follow' });
});
app.get('/forgot-password', (req, res) =>
  renderPage(res, 'forgot-password.html', { title: 'Reset your password', canonical: '/forgot-password', robots: 'noindex, nofollow' })
);
app.get('/reset-password', (req, res) =>
  renderPage(res, 'reset-password.html', { title: 'Choose a new password', canonical: '/reset-password', robots: 'noindex, nofollow' })
);

app.get('/dashboard', requirePage(['creator']), (req, res) =>
  renderPage(res, 'creator-dashboard.html', { title: 'Creator Dashboard', canonical: '/dashboard', robots: 'noindex, nofollow' })
);
app.get('/brand/dashboard', requirePage(['brand']), (req, res) =>
  renderPage(res, 'brand-dashboard.html', { title: 'Brand Dashboard', canonical: '/brand/dashboard', robots: 'noindex, nofollow' })
);
app.get('/brand/programs/new', requirePage(['brand']), (req, res) =>
  renderPage(res, 'add-program.html', { title: 'Add a Program', canonical: '/brand/programs/new', robots: 'noindex, nofollow' })
);
app.get('/brand/programs/:id/edit', requirePage(['brand']), (req, res) =>
  renderPage(res, 'add-program.html', { title: 'Edit Program', canonical: req.path, robots: 'noindex, nofollow' })
);
app.get('/admin', requirePage(['admin']), (req, res) =>
  renderPage(res, 'admin-dashboard.html', { title: 'Admin', canonical: '/admin', robots: 'noindex, nofollow' })
);

app.get('/sitemap.xml', (req, res, next) => {
  (async () => {
  const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  const statics = ['/', '/programs', '/categories', '/for-brands', '/resources', '/about', '/contact', '/privacy', '/terms', '/login', '/register'];
  const programs = await many(`SELECT slug, updated_at FROM affiliate_programs WHERE status = 'approved' ORDER BY updated_at DESC`);
  const urls = [
    ...statics.map((p) => ({ loc: `${siteUrl}${p}`, lastmod: new Date().toISOString().slice(0, 10), priority: p === '/' ? '1.0' : '0.7' })),
    ...programs.map((p) => ({ loc: `${siteUrl}/programs/${p.slug}`, lastmod: String(p.updated_at).slice(0, 10), priority: '0.8' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
  })().catch(next);
});

app.get('/robots.txt', (req, res) => {
  const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /brand/\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  renderPage(res, '404.html', { status: 404, title: 'Page not found', robots: 'noindex, follow' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

app.use((err, req, res, next) => {
  console.error('[affilink]', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  res.status(500).type('text').send('Something went wrong.');
});

// On Vercel the Express app is invoked as a single function, so only listen
// when running as a normal Node server (local, Railway, a VPS, etc.).
if (!process.env.VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Affilink running on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

export default app;
