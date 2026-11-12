import fs from 'node:fs';
import path from 'node:path';
import { db, many, one, run, transaction, ROOT, nowIso } from './db.js';
import { hashPassword } from './security.js';
import { REAL_PROGRAMS, VERIFIED_AT } from './real-programs.js';

const LOGO_DIR = path.join(ROOT, 'assets', 'logos');
try {
  fs.mkdirSync(LOGO_DIR, { recursive: true });
} catch {
  // Read-only filesystem (e.g. Vercel): the logo files ship with the repo.
}

const CATEGORIES = [
  ['saas', 'SaaS', 'Work management, website builders and subscription software', 'bi-cloud-arrow-up', '#6457f9'],
  ['ai-tools', 'AI Tools', 'Writing assistants and AI-powered productivity software', 'bi-stars', '#7c3aed'],
  ['ecommerce', 'Ecommerce', 'Storefronts, print-on-demand and marketplaces', 'bi-bag-check', '#f97316'],
  ['hosting', 'Hosting', 'Web hosting, domains and cloud infrastructure', 'bi-hdd-network', '#2563eb'],
  ['education', 'Education', 'Online courses, coaching and learning platforms', 'bi-mortarboard', '#14b8a6'],
  ['marketing', 'Marketing', 'SEO, email, CRM and growth software', 'bi-megaphone', '#e11d48'],
  ['travel', 'Travel', 'Bookings, stays and travel experiences', 'bi-compass', '#06b6d4'],
  ['technology', 'Technology', 'Devices, privacy tools and creator platforms', 'bi-cpu', '#475569'],
];

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

function brandLogo(slug, name, [c1, c2]) {
  const initials = name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${name} logo placeholder">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="24" fill="url(#g)"/>
  <text x="48" y="50" text-anchor="middle" dominant-baseline="central" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#ffffff" letter-spacing="-1">${initials}</text>
</svg>`;
  try {
    fs.writeFileSync(path.join(LOGO_DIR, `${slug}.svg`), svg);
  } catch {
    // Read-only filesystem (e.g. Vercel): serve the logo already in the repo,
    // or let it 404 rather than taking the whole app down.
  }
  return `/logos/${slug}.svg`;
}

const NETWORK_SLUG = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function seedUsers() {
  const now = nowIso();
  const admin = { email: 'admin@affilink.demo', name: 'Avery Sloan', role: 'admin' };
  const creator = { email: 'creator@affilink.demo', name: 'Maya Chen', role: 'creator' };
  const brand = { email: 'brand@affilink.demo', name: 'Jordan Ellis', role: 'brand' };
  const extraCreator = { email: 'diego@affilink.demo', name: 'Diego Ramos', role: 'creator' };
  const pendingBrand = { email: 'lena@northwind.demo', name: 'Lena Fischer', role: 'brand' };

  const insertUser = (u, password, days) => {
    const { lastInsertRowid: id } = run(
      `INSERT INTO users (email, password_hash, name, role, status, avatar_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      u.email,
      hashPassword(password),
      u.name,
      u.role,
      'active',
      null,
      daysAgo(days),
      now
    );
    return id;
  };

  const adminId = insertUser(admin, 'Admin123!', 120);
  const creatorId = insertUser(creator, 'Creator123!', 40);
  const brandId = insertUser(brand, 'Brand123!', 55);
  const extraCreatorId = insertUser(extraCreator, 'Creator123!', 12);
  const pendingBrandId = insertUser(pendingBrand, 'Brand123!', 2);

  run(
    `INSERT INTO creator_profiles (user_id, website, twitter, linkedin, instagram, youtube, niche, audience_size, country, promo_methods, bio, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    creatorId,
    'https://mayachen.demo',
    'https://twitter.com/mayachen',
    'https://linkedin.com/in/mayachen',
    'https://instagram.com/mayachen',
    'https://youtube.com/@mayachen',
    'SaaS & Productivity',
    '48,000',
    'United States',
    JSON.stringify(['Content / blog', 'YouTube', 'Newsletter']),
    'I write about tools that help small teams ship faster. Audience of founders and ops leads.',
    now
  );

  run(
    `INSERT INTO creator_profiles (user_id, website, twitter, niche, audience_size, country, promo_methods, bio, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    extraCreatorId,
    'https://diegoramos.demo',
    'https://twitter.com/diegoramos',
    'AI & Developer Tools',
    '12,500',
    'Spain',
    JSON.stringify(['YouTube', 'Live streams']),
    'Developer educator covering AI tooling.',
    now
  );

  run(
    `INSERT INTO brand_profiles (user_id, company_name, website, logo_url, contact_email, country, about, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    brandId,
    'Northwind Labs',
    'https://northwind.demo',
    '/logos/northwind-analytics.svg',
    'partners@northwind.demo',
    'United Kingdom',
    'A demo brand profile used to showcase the Affilink brand dashboard.',
    now
  );

  run(
    `INSERT INTO brand_profiles (user_id, company_name, website, logo_url, contact_email, country, about, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    pendingBrandId,
    'Solstice Health',
    'https://solstice.demo',
    '/logos/affilink.svg',
    'hello@solstice.demo',
    'Germany',
    'Demo brand awaiting review.',
    now
  );

  return { adminId, creatorId, brandId, pendingBrandId };
}

export function seedDatabase() {
  const existing = one('SELECT COUNT(*) AS c FROM categories');
  if (existing && existing.c > 0) return false;

  transaction(() => {
    const now = nowIso();
    const catIds = {};
    CATEGORIES.forEach(([slug, name, description, icon, accent], i) => {
      const { lastInsertRowid } = run(
        `INSERT INTO categories (slug, name, description, icon, accent, position, created_at) VALUES (?,?,?,?,?,?,?)`,
        slug,
        name,
        description,
        icon,
        accent,
        i,
        now
      );
      catIds[slug] = lastInsertRowid;
    });

    const { creatorId, brandId, pendingBrandId } = seedUsers();

    REAL_PROGRAMS.forEach((p, index) => {
      const logo = brandLogo(p.slug, p.brand, p.colors);
      const created = daysAgo(index < 7 ? Math.min(p.days, 2 + index * 3) : p.days);
      const [type, value, label] = p.commission;
      const { lastInsertRowid: pid } = run(
        `INSERT INTO affiliate_programs
         (slug, brand_name, logo_url, title, description, category_id, website_url, signup_url,
          commission_type, commission_value, commission_label, commission_tiers, cookie_days, min_payout,
          currency, payment_frequency, payment_methods, network, eligible_countries, promo_methods,
          requirements, contact_email, brand_user_id, status, featured, is_demo, source_url, verified_at,
          view_count, click_count, save_count, created_at, updated_at, approved_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.slug,
        p.brand,
        logo,
        p.title,
        p.desc,
        catIds[p.cat],
        p.website,
        p.signup,
        type,
        value,
        label,
        null,
        p.cookie,
        p.payout,
        'USD',
        p.freq,
        JSON.stringify(p.pay),
        p.network,
        p.countries,
        JSON.stringify(p.promo),
        p.req,
        null,
        null,
        'approved',
        p.featured,
        0,
        p.source,
        VERIFIED_AT,
        p.views,
        p.clicks,
        Math.round(p.views / 12),
        created,
        created,
        created
      );
      if (p.featured) {
        run(`INSERT INTO featured_programs (program_id, position, created_at) VALUES (?,?,?)`, pid, index, now);
      }
    });

    // Brand-owned demo listings so the brand + admin flows have real pending data.
    const ownedByBrand = [
      {
        slug: 'northwind-analytics',
        brand: 'Northwind Labs',
        title: 'Northwind Analytics Affiliate Program',
        desc: 'Privacy-first product analytics for growing SaaS teams. Refer a team and earn recurring commission for two years.',
        commission_type: 'recurring',
        commission_value: 25,
        commission_label: '25% recurring for 24 months',
        cookie: 60,
        status: 'approved',
        featured: 0,
        views: 214,
        clicks: 31,
      },
      {
        slug: 'solstice-sleep',
        brand: 'Solstice Health',
        title: 'Solstice Sleep Affiliate Program',
        desc: 'Evidence-led sleep supplements and recovery routines. Awaiting review from the Affilink team.',
        commission_type: 'percentage',
        commission_value: 15,
        commission_label: '15% of order value',
        cookie: 30,
        status: 'pending',
        featured: 0,
        views: 0,
        clicks: 0,
      },
    ];

    ownedByBrand.forEach((p, i) => {
      const logo = brandLogo(p.slug, p.brand, i % 2 ? ['#0f766e', '#22c55e'] : ['#6457f9', '#22d3ee']);
      const created = daysAgo(6 - i);
      run(
        `INSERT INTO affiliate_programs
         (slug, brand_name, logo_url, title, description, category_id, website_url, signup_url,
          commission_type, commission_value, commission_label, cookie_days, min_payout, currency,
          payment_frequency, payment_methods, network, eligible_countries, promo_methods, requirements,
          contact_email, brand_user_id, status, featured, is_demo, view_count, click_count, save_count,
          created_at, updated_at, approved_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.slug,
        p.brand,
        logo,
        p.title,
        p.desc,
        catIds.saas,
        'https://northwind.demo',
        'https://northwind.demo/affiliates',
        p.commission_type,
        p.commission_value,
        p.commission_label,
        p.cookie,
        50,
        'USD',
        'Monthly',
        JSON.stringify(['PayPal', 'Bank transfer']),
        'PartnerStack',
        'Worldwide',
        JSON.stringify(['Content / blog', 'Newsletter']),
        'Active website or newsletter with a SaaS or ops audience.',
        p.status === 'pending' ? 'hello@solstice.demo' : 'partners@northwind.demo',
        p.status === 'pending' ? pendingBrandId : brandId,
        p.status,
        p.featured,
        1,
        p.views,
        p.clicks,
        Math.round(p.views / 10),
        created,
        created,
        p.status === 'approved' ? created : null
      );
    });

    // Demo creator activity
    const semrush = one('SELECT id FROM affiliate_programs WHERE slug = ?', 'semrush');
    const webflow = one('SELECT id FROM affiliate_programs WHERE slug = ?', 'webflow');
    const framer = one('SELECT id FROM affiliate_programs WHERE slug = ?', 'framer');
    const shopify = one('SELECT id FROM affiliate_programs WHERE slug = ?', 'shopify');
    [
      [semrush.id, 'approved'],
      [webflow.id, 'pending'],
      [framer.id, 'pending'],
    ].forEach(([id, status], i) => {
      run(
        `INSERT INTO applications (user_id, program_id, status, applied_at, notes, updated_at) VALUES (?,?,?,?,?,?)`,
        creatorId,
        id,
        status,
        daysAgo(18 - i * 5),
        i === 0 ? 'Approved through Impact.' : 'Applied through the network portal.',
        daysAgo(10 - i)
      );
    });
    [semrush.id, shopify.id, framer.id].forEach((id, i) => {
      run(`INSERT INTO saved_programs (user_id, program_id, created_at) VALUES (?,?,?)`, creatorId, id, daysAgo(9 - i));
    });

    // Creator-owned affiliate links (the creator account's own Amazon/Booking links).
    [
      {
        slug: 'mayas-amazon-gear-list',
        brand: 'Amazon Associates',
        title: 'Maya’s desk and studio gear',
        category: 'ecommerce',
        url: 'https://www.amazon.com/?tag=mayachen-20',
        note: 'Category rate card (up to 10%)',
        desc: 'Every piece of gear on my desk, linked with my own Amazon Associates tag.',
        clicks: 128,
        days: 21,
      },
      {
        slug: 'mayas-booking-city-breaks',
        brand: 'Booking.com',
        title: 'Booking.com city-break picks',
        category: 'travel',
        url: 'https://www.booking.com/?aid=mayachen',
        note: '25–40% of Booking.com’s commission',
        desc: 'The stays I actually book for work trips, collected in one shareable link.',
        clicks: 46,
        days: 9,
      },
    ].forEach((o) => {
      run(
        `INSERT INTO creator_offers (user_id, slug, brand_name, title, category, destination_url, commission_note, description, clicks, is_active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        creatorId,
        o.slug,
        o.brand,
        o.title,
        o.category,
        o.url,
        o.note,
        o.desc,
        o.clicks,
        1,
        daysAgo(o.days),
        daysAgo(o.days)
      );
    });

    // Seed 30 days of view history so dashboards and charts start with believable data.
    const seedPrograms = [
      ...new Set([
        semrush.id,
        shopify.id,
        framer.id,
        webflow.id,
        ...many('SELECT id FROM affiliate_programs WHERE brand_user_id IS NOT NULL').map((r) => r.id),
      ]),
    ];
    for (let d = 29; d >= 0; d--) {
      const perDay = 4 + Math.round((30 - d) / 4) + (d % 3);
      for (let i = 0; i < perDay; i++) {
        run(
          `INSERT INTO program_views (program_id, user_id, visitor, created_at) VALUES (?,?,?,?)`,
          seedPrograms[i % seedPrograms.length],
          null,
          `seed-${d}-${i}`,
          new Date(Date.now() - d * DAY + i * 3600_000).toISOString()
        );
      }
      for (let i = 0; i < Math.max(2, Math.round(perDay / 5)); i++) {
        run(
          `INSERT INTO outbound_clicks (program_id, user_id, created_at) VALUES (?,?,?)`,
          seedPrograms[(d + i) % seedPrograms.length],
          null,
          new Date(Date.now() - d * DAY + i * 7200_000).toISOString()
        );
      }
    }

    const testimonials = [
      ['Maya Chen', 'SaaS creator · 48k subscribers', 'I stopped guessing which programs were worth my time. Filtering by cookie length and recurring payout changed my whole content calendar.', 5],
      ['Diego Ramos', 'Developer educator', 'The comparison data is the part I use most. Seeing network, payout and requirements in one view saves me hours every month.', 5],
      ['Priya Nair', 'Affiliate publisher', 'Saved programs and application tracking finally live in one place instead of a messy spreadsheet.', 5],
      ['Tom Okafor', 'Newsletter operator', 'I found three finance programs in a niche I had never covered. Two of them now out-earn my old top offer.', 4],
      ['Sara Lindqvist', 'Brand partnerships lead', 'Listing our program took ten minutes. The review process was clear and the traffic quality has been strong.', 5],
    ];
    testimonials.forEach(([name, role, quote, rating], i) => {
      run(
        `INSERT INTO testimonials (name, role, quote, avatar_url, rating, status, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?)`,
        name,
        role,
        quote,
        null,
        rating,
        'published',
        1,
        daysAgo(30 - i * 4)
      );
    });

    const content = {
      hero_title: 'Find Affiliate Programs Worth Promoting.',
      hero_subtitle:
        'Discover thousands of affiliate opportunities from leading brands. Compare commissions, explore niches, and find your next revenue stream.',
      brand_headline: 'Get Your Affiliate Program Discovered.',
      brand_copy:
        'Put your program in front of creators, publishers and niche experts who are already writing about what you sell. Publish once, get discovered by the people who convert.',
      announcement: 'Program terms are checked against official affiliate pages. Accounts, saves and submissions in this environment are demo data.',
    };
    Object.entries(content).forEach(([key, value]) => {
      run(`INSERT INTO site_content (key, value, updated_at) VALUES (?,?,?)`, key, value, now);
    });

  });

  return true;
}

// Re-export for scripts
export { REAL_PROGRAMS as PROGRAMS, CATEGORIES, NETWORK_SLUG };
export const seedIfEmpty = () => seedDatabase();
