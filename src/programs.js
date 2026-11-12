import { many, one } from './db.js';

const json = (value, fallback = []) => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export function serializeProgram(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    brandName: row.brand_name,
    logoUrl: row.logo_url,
    title: row.title,
    description: row.description,
    category: row.category_slug ? { slug: row.category_slug, name: row.category_name, icon: row.category_icon, accent: row.category_accent } : null,
    websiteUrl: row.website_url,
    signupUrl: row.signup_url,
    commissionType: row.commission_type,
    commissionValue: Number(row.commission_value),
    commissionLabel: row.commission_label,
    commissionTiers: json(row.commission_tiers),
    cookieDays: row.cookie_days,
    minPayout: Number(row.min_payout),
    currency: row.currency,
    paymentFrequency: row.payment_frequency,
    paymentMethods: json(row.payment_methods),
    network: row.network,
    eligibleCountries: row.eligible_countries,
    promoMethods: json(row.promo_methods),
    requirements: row.requirements,
    contactEmail: row.contact_email,
    status: row.status,
    featured: Boolean(row.featured),
    isDemo: Boolean(row.is_demo),
    sourceUrl: row.source_url || null,
    verifiedAt: row.verified_at || null,
    viewCount: row.view_count,
    clickCount: row.click_count,
    saveCount: row.save_count,
    rejectionReason: row.rejection_reason,
    brandUserId: row.brand_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rating: row.rating_avg ? Number(row.rating_avg).toFixed(1) : null,
    reviewCount: row.review_count ?? 0,
    ...extra,
  };
}

const SELECT_BASE = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent,
         (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.program_id = p.id AND r.status = 'approved') AS rating_avg,
         (SELECT COUNT(*) FROM reviews r WHERE r.program_id = p.id AND r.status = 'approved') AS review_count
    FROM affiliate_programs p
    LEFT JOIN categories c ON c.id = p.category_id
`;

const SORTS = {
  newest: 'p.created_at DESC',
  oldest: 'p.created_at ASC',
  commission: 'p.commission_value DESC, p.created_at DESC',
  popularity: '(p.view_count + p.click_count * 4 + p.save_count * 6) DESC',
  alpha: 'LOWER(p.brand_name) ASC',
};

export function buildProgramQuery(filters = {}) {
  const where = ["p.status = 'approved'"];
  const params = [];

  const search = String(filters.search || '').trim().slice(0, 120);
  if (search) {
    where.push('(p.brand_name LIKE ? OR p.title LIKE ? OR p.description LIKE ? OR c.name LIKE ? OR p.network LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.category && /^[a-z0-9-]{1,60}$/.test(filters.category)) {
    where.push('c.slug = ?');
    params.push(filters.category);
  }
  if (filters.commissionType && ['percentage', 'recurring', 'fixed', 'tiered'].includes(filters.commissionType)) {
    where.push('p.commission_type = ?');
    params.push(filters.commissionType);
  }
  const minCommission = Number(filters.minCommission);
  if (Number.isFinite(minCommission) && minCommission > 0) {
    where.push('p.commission_value >= ?');
    params.push(minCommission);
  }
  const minCookie = Number(filters.minCookie);
  if (Number.isFinite(minCookie) && minCookie > 0) {
    where.push('p.cookie_days >= ?');
    params.push(minCookie);
  }
  if (filters.network) {
    where.push('p.network = ?');
    params.push(String(filters.network).slice(0, 60));
  }
  if (filters.paymentMethod) {
    where.push('p.payment_methods LIKE ?');
    params.push(`%${String(filters.paymentMethod).slice(0, 40)}%`);
  }
  if (filters.featured === 'true') where.push('p.featured = 1');
  if (filters.brandUserId) {
    where.push('p.brand_user_id = ?');
    params.push(Number(filters.brandUserId));
  }

  const perPage = Math.min(Math.max(Number(filters.perPage) || 9, 1), 48);
  const page = Math.max(Number(filters.page) || 1, 1);
  const sort = SORTS[filters.sort] || SORTS.newest;

  return {
    where: where.join(' AND '),
    params,
    order: sort,
    page,
    perPage,
    offset: (page - 1) * perPage,
  };
}

export async function listPrograms(filters = {}) {
  const q = buildProgramQuery(filters);
  const total = (await one(`SELECT COUNT(*) AS c FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id WHERE ${q.where}`, ...q.params)).c;
  const rows = await many(
    `${SELECT_BASE} WHERE ${q.where} ORDER BY ${q.order} LIMIT ? OFFSET ?`,
    ...q.params,
    q.perPage,
    q.offset
  );
  return {
    items: rows.map((r) => serializeProgram(r)),
    total,
    page: q.page,
    perPage: q.perPage,
    totalPages: Math.max(1, Math.ceil(total / q.perPage)),
  };
}

export async function facets() {
  const categoryRows = await many(
    `SELECT c.slug, c.name, c.icon, c.accent, COUNT(p.id) AS count
       FROM categories c LEFT JOIN affiliate_programs p ON p.category_id = c.id AND p.status = 'approved'
      GROUP BY c.id, c.slug, c.name, c.icon, c.accent, c.position ORDER BY c.position, c.name`
  );
  const networks = await many(
    `SELECT network AS value, COUNT(*) AS count FROM affiliate_programs WHERE status = 'approved' GROUP BY network ORDER BY count DESC`
  );
  const commissionTypes = await many(
    `SELECT commission_type AS value, COUNT(*) AS count FROM affiliate_programs WHERE status = 'approved' GROUP BY commission_type`
  );
  const paymentMap = new Map();
  const paymentRows = await many(`SELECT payment_methods FROM affiliate_programs WHERE status = 'approved'`);
  paymentRows.forEach((row) => {
    let parsed = [];
    try {
      parsed = JSON.parse(row.payment_methods || '[]');
    } catch {
      parsed = [];
    }
    parsed.forEach((m) => paymentMap.set(m, (paymentMap.get(m) || 0) + 1));
  });
  const paymentMethods = [...paymentMap.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return { categories: categoryRows, networks, commissionTypes, paymentMethods };
}

export async function getProgramBySlug(slug, viewerId = null) {
  const row = await one(`${SELECT_BASE} WHERE p.slug = ?`, slug);
  if (!row) return null;
  const extra = {};
  if (viewerId) {
    extra.saved = Boolean(await one('SELECT id FROM saved_programs WHERE user_id = ? AND program_id = ?', viewerId, row.id));
    extra.application = (await one('SELECT status, applied_at, notes FROM applications WHERE user_id = ? AND program_id = ?', viewerId, row.id)) || null;
  } else {
    extra.saved = false;
    extra.application = null;
  }
  const reviews = await many(
    `SELECT id, author, rating, body, created_at FROM reviews WHERE program_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 8`,
    row.id
  );
  const similar = (
    await many(
      `${SELECT_BASE} WHERE p.status = 'approved' AND p.id != ? AND p.category_id = ? ORDER BY (p.view_count + p.click_count * 4) DESC LIMIT 3`,
      row.id,
      row.category_id
    )
  ).map((r) => serializeProgram(r));
  return { ...serializeProgram(row, extra), reviews, similar };
}

export async function platformStats() {
  const programs = (await one(`SELECT COUNT(*) AS c FROM affiliate_programs WHERE status = 'approved'`)).c;
  const brands = (await one(`SELECT COUNT(DISTINCT brand_name) AS c FROM affiliate_programs WHERE status = 'approved'`)).c;
  const categories = (await one(`SELECT COUNT(*) AS c FROM categories`)).c;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = (
    await one(
      `SELECT COUNT(*) AS c FROM affiliate_programs WHERE status = 'approved' AND created_at >= ?`,
      monthStart.toISOString()
    )
  ).c;
  const totalViews = (await one(`SELECT SUM(view_count) AS c FROM affiliate_programs WHERE status = 'approved'`)).c || 0;
  return { programs, brands, categories, newThisMonth, totalViews };
}
