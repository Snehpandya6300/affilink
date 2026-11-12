import { Router } from 'express';
import { many, one, insert, run, transaction, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { serializeProgram } from '../programs.js';
import { validateProgramInput, uniqueSlug } from '../validate.js';
import { cleanString, isHttpUrl } from '../security.js';

const router = Router();
router.use(requireAuth('brand'));

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const PROGRAM_SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent
    FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
`;

function ownProgram(id, userId) {
  return one(
    `SELECT p.*, c.slug AS category_slug FROM affiliate_programs p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.brand_user_id = ?`,
    Number(id),
    userId
  );
}

async function dailySeries(programIds, days = 14) {
  if (!programIds.length) return [];
  const placeholders = programIds.map(() => '?').join(',');
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);
  const views = await many(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM program_views
      WHERE program_id IN (${placeholders}) AND created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ...programIds,
    since.toISOString()
  );
  const clicks = await many(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM outbound_clicks
      WHERE program_id IN (${placeholders}) AND created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ...programIds,
    since.toISOString()
  );
  const viewMap = new Map(views.map((v) => [v.day, v.c]));
  const clickMap = new Map(clicks.map((v) => [v.day, v.c]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, views: viewMap.get(key) || 0, clicks: clickMap.get(key) || 0 });
  }
  return out;
}

router.get('/overview', wrap(async (req, res) => {
  const programs = (await many(`${PROGRAM_SELECT} WHERE p.brand_user_id = ? ORDER BY p.created_at DESC`, req.user.id)).map((r) =>
    serializeProgram(r)
  );
  const ids = programs.map((p) => p.id);
  const statusCounts = programs.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  const totals = ids.length
    ? await one(
        `SELECT COALESCE(SUM(view_count),0) AS views, COALESCE(SUM(click_count),0) AS clicks, COALESCE(SUM(save_count),0) AS saves
           FROM affiliate_programs WHERE brand_user_id = ?`,
        req.user.id
      )
    : { views: 0, clicks: 0, saves: 0 };
  const reviews = ids.length
    ? await many(
        `SELECT r.id, r.author, r.rating, r.body, r.status, r.created_at, p.brand_name, p.slug
           FROM reviews r JOIN affiliate_programs p ON p.id = r.program_id
          WHERE p.brand_user_id = ? ORDER BY r.created_at DESC LIMIT 5`,
        req.user.id
      )
    : [];
  res.json({
    user: req.user,
    programs,
    stats: {
      total: programs.length,
      approved: statusCounts.approved || 0,
      pending: statusCounts.pending || 0,
      rejected: statusCounts.rejected || 0,
      views: totals.views,
      clicks: totals.clicks,
      saves: totals.saves,
      clickRate: totals.views ? ((totals.clicks / totals.views) * 100).toFixed(1) : '0.0',
    },
    series: await dailySeries(ids),
    reviews,
  });
}));

router.get('/programs', wrap(async (req, res) => {
  const rows = await many(`${PROGRAM_SELECT} WHERE p.brand_user_id = ? ORDER BY p.created_at DESC`, req.user.id);
  res.json({ items: rows.map((r) => serializeProgram(r)) });
}));

router.get('/programs/:id', wrap(async (req, res) => {
  const row = await one(`${PROGRAM_SELECT} WHERE p.id = ? AND p.brand_user_id = ?`, Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Program not found.' });
  const program = serializeProgram(row);
  res.json({ program });
}));

router.get('/programs/:id/analytics', wrap(async (req, res) => {
  const row = await one(`SELECT id, view_count, click_count, save_count, slug, brand_name FROM affiliate_programs WHERE id = ? AND brand_user_id = ?`, Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Program not found.' });
  res.json({
    program: row,
    series: await dailySeries([row.id], 30),
    totals: { views: row.view_count, clicks: row.click_count, saves: row.save_count },
    ctr: row.view_count ? ((row.click_count / row.view_count) * 100).toFixed(1) : '0.0',
  });
}));

function normalizePayload(body) {
  return { ...body, category: body.category || body.categorySlug };
}

async function persistNew(userId, body) {
  const { errors, data, hasErrors } = await validateProgramInput(normalizePayload(body));
  if (hasErrors) return { errors };
  const now = nowIso();
  const slug = await uniqueSlug(body.slug || `${data.brandName} ${data.title}`);
  const id = await insert(
    `INSERT INTO affiliate_programs
      (slug, brand_name, logo_url, title, description, category_id, website_url, signup_url, commission_type,
       commission_value, commission_label, commission_tiers, cookie_days, min_payout, currency, payment_frequency,
       payment_methods, network, eligible_countries, promo_methods, requirements, contact_email, brand_user_id,
       status, featured, is_demo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,0,?,?)`,
    slug,
    data.brandName,
    data.logoUrl || '/logos/affilink.svg',
    data.title,
    data.description,
    data.categoryId,
    data.websiteUrl,
    data.signupUrl,
    data.commissionType,
    data.commissionValue,
    data.commissionLabel,
    data.commissionTiers,
    data.cookieDays,
    data.minPayout,
    'USD',
    data.paymentFrequency,
    data.paymentMethods,
    data.network,
    data.eligibleCountries,
    data.promoMethods,
    data.requirements,
    data.contactEmail,
    userId,
    now,
    now
  );
  return { id, slug };
}

router.post('/programs', wrap(async (req, res) => {
  const result = await persistNew(req.user.id, req.body || {});
  if (result.errors) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: result.errors });
  res.status(201).json({
    id: result.id,
    slug: result.slug,
    message: 'Program submitted for review. It will appear publicly once approved.',
  });
}));

router.put('/programs/:id', wrap(async (req, res) => {
  const existing = await ownProgram(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  const body = req.body || {};
  const merged = {
    brandName: body.brandName ?? existing.brand_name,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    category: body.category ?? existing.category_slug,
    websiteUrl: body.websiteUrl ?? existing.website_url,
    signupUrl: body.signupUrl ?? existing.signup_url,
    commissionType: body.commissionType ?? existing.commission_type,
    commissionValue: body.commissionValue ?? existing.commission_value,
    commissionLabel: body.commissionLabel ?? existing.commission_label,
    commissionTiers: body.commissionTiers ?? JSON.parse(existing.commission_tiers || '[]'),
    cookieDays: body.cookieDays ?? existing.cookie_days,
    minPayout: body.minPayout ?? existing.min_payout,
    paymentFrequency: body.paymentFrequency ?? existing.payment_frequency,
    paymentMethods: body.paymentMethods ?? JSON.parse(existing.payment_methods || '[]'),
    network: body.network ?? existing.network,
    eligibleCountries: body.eligibleCountries ?? existing.eligible_countries,
    promoMethods: body.promoMethods ?? JSON.parse(existing.promo_methods || '[]'),
    requirements: body.requirements ?? existing.requirements,
    contactEmail: body.contactEmail ?? existing.contact_email,
    logoUrl: body.logoUrl ?? existing.logo_url,
  };
  const { errors, data, hasErrors } = await validateProgramInput(normalizePayload(merged));
  if (hasErrors) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  const now = nowIso();
  await transaction(async () => {
    await run(
      `UPDATE affiliate_programs SET brand_name = ?, logo_url = ?, title = ?, description = ?, category_id = ?,
              website_url = ?, signup_url = ?, commission_type = ?, commission_value = ?, commission_label = ?,
              commission_tiers = ?, cookie_days = ?, min_payout = ?, payment_frequency = ?, payment_methods = ?,
              network = ?, eligible_countries = ?, promo_methods = ?, requirements = ?, contact_email = ?,
              status = 'pending', rejection_reason = NULL, updated_at = ?
        WHERE id = ?`,
      data.brandName,
      data.logoUrl || existing.logo_url,
      data.title,
      data.description,
      data.categoryId,
      data.websiteUrl,
      data.signupUrl,
      data.commissionType,
      data.commissionValue,
      data.commissionLabel,
      data.commissionTiers,
      data.cookieDays,
      data.minPayout,
      data.paymentFrequency,
      data.paymentMethods,
      data.network,
      data.eligibleCountries,
      data.promoMethods,
      data.requirements,
      data.contactEmail,
      now,
      existing.id
    );
  });
  res.json({ message: 'Changes saved and resubmitted for review.' });
}));

router.delete('/programs/:id', wrap(async (req, res) => {
  const existing = await ownProgram(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  await run('DELETE FROM affiliate_programs WHERE id = ?', existing.id);
  res.json({ message: 'Program deleted.' });
}));

router.get('/profile', wrap(async (req, res) => {
  const user = await one('SELECT name, email, avatar_url FROM users WHERE id = ?', req.user.id);
  const profile = (await one('SELECT * FROM brand_profiles WHERE user_id = ?', req.user.id)) || {};
  res.json({
    profile: {
      name: user.name,
      email: user.email,
      companyName: profile.company_name || '',
      website: profile.website || '',
      logoUrl: profile.logo_url || '',
      contactEmail: profile.contact_email || user.email,
      country: profile.country || '',
      about: profile.about || '',
    },
  });
}));

router.put('/profile', wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  const name = cleanString(b.name, 80);
  const companyName = cleanString(b.companyName, 100);
  if (name.length < 2) fields.name = 'Enter your name.';
  if (companyName.length < 2) fields.companyName = 'Enter your company name.';
  const website = cleanString(b.website, 300);
  const logoUrl = cleanString(b.logoUrl, 400);
  const contactEmail = cleanString(b.contactEmail, 160);
  if (website && !isHttpUrl(website)) fields.website = 'Enter a full https:// URL.';
  if (logoUrl && !isHttpUrl(logoUrl) && !/^\/(logos|images)\//.test(logoUrl)) fields.logoUrl = 'Enter a valid image URL.';
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contactEmail)) fields.contactEmail = 'Enter a valid email.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });
  const now = nowIso();
  await transaction(async () => {
    await run('UPDATE users SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?', name, logoUrl || null, now, req.user.id);
    await run(
      `UPDATE brand_profiles SET company_name = ?, website = ?, logo_url = ?, contact_email = ?, country = ?, about = ?, updated_at = ?
        WHERE user_id = ?`,
      companyName,
      website || null,
      logoUrl || null,
      contactEmail || req.user.email,
      cleanString(b.country, 60) || null,
      cleanString(b.about, 800) || null,
      now,
      req.user.id
    );
  });
  res.json({ ok: true, message: 'Brand profile saved.' });
}));

export default router;
