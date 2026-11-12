import { Router } from 'express';
import { many, one, insert, run, transaction, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { serializeProgram } from '../programs.js';
import { cleanString, isHttpUrl, safeJsonArray } from '../security.js';
import { uniqueSlug } from '../validate.js';

const router = Router();
router.use(requireAuth('creator'));

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const PROGRAM_SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent
    FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
`;

router.get('/overview', wrap(async (req, res) => {
  const userId = req.user.id;
  const savedCount = (await one('SELECT COUNT(*) AS c FROM saved_programs WHERE user_id = ?', userId)).c;
  const appCounts = await many('SELECT status, COUNT(*) AS c FROM applications WHERE user_id = ? GROUP BY status', userId);
  const counts = Object.fromEntries(appCounts.map((r) => [r.status, r.c]));

  const saved = (
    await many(
      `${PROGRAM_SELECT} JOIN saved_programs s ON s.program_id = p.id
      WHERE s.user_id = ? AND p.status = 'approved' ORDER BY s.created_at DESC LIMIT 4`,
      userId
    )
  ).map((r) => serializeProgram(r, { saved: true }));

  const recent = (
    await many(`${PROGRAM_SELECT} WHERE p.status = 'approved' ORDER BY p.created_at DESC LIMIT 4`)
  ).map((r) => serializeProgram(r));

  const recommended = (
    await many(
      `${PROGRAM_SELECT}
      WHERE p.status = 'approved'
        AND p.id NOT IN (SELECT program_id FROM saved_programs WHERE user_id = ?)
      ORDER BY p.featured DESC, (p.view_count + p.click_count * 4) DESC LIMIT 4`,
      userId
    )
  ).map((r) => serializeProgram(r));

  const viewed = (
    await many(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent,
            MAX(v.created_at) AS viewed_at
       FROM program_views v
       JOIN affiliate_programs p ON p.id = v.program_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE v.user_id = ? AND p.status = 'approved'
      GROUP BY p.id, c.slug, c.name, c.icon, c.accent
      ORDER BY MAX(v.created_at) DESC LIMIT 5`,
      userId
    )
  ).map((r) => serializeProgram(r, { viewedAt: r.viewed_at }));

  const applications = await many(
    `SELECT a.id, a.status, a.applied_at, a.updated_at, a.notes, p.brand_name, p.slug, p.logo_url, p.commission_label
       FROM applications a JOIN affiliate_programs p ON p.id = a.program_id
      WHERE a.user_id = ? ORDER BY a.applied_at DESC LIMIT 5`,
    userId
  );

  res.json({
    user: req.user,
    stats: {
      saved: savedCount,
      applications: counts.pending || 0,
      approved: counts.approved || 0,
      totalApplications: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    saved,
    recent,
    recommended,
    viewed,
    applications,
  });
}));

router.get('/saved', wrap(async (req, res) => {
  const rows = await many(
    `${PROGRAM_SELECT} JOIN saved_programs s ON s.program_id = p.id
      WHERE s.user_id = ? AND p.status = 'approved' ORDER BY s.created_at DESC`,
    req.user.id
  );
  res.json({ items: rows.map((r) => serializeProgram(r, { saved: true })) });
}));

router.post('/saved/:programId', wrap(async (req, res) => {
  const program = await one(`SELECT id FROM affiliate_programs WHERE id = ? AND status = 'approved'`, Number(req.params.programId));
  if (!program) return res.status(404).json({ error: 'Program not found.' });
  const existing = await one('SELECT id FROM saved_programs WHERE user_id = ? AND program_id = ?', req.user.id, program.id);
  if (existing) return res.json({ saved: true, message: 'Already saved.' });
  await transaction(async () => {
    await run('INSERT INTO saved_programs (user_id, program_id, created_at) VALUES (?,?,?)', req.user.id, program.id, nowIso());
    await run('UPDATE affiliate_programs SET save_count = save_count + 1 WHERE id = ?', program.id);
  });
  res.status(201).json({ saved: true, message: 'Saved to your programs.' });
}));

router.delete('/saved/:programId', wrap(async (req, res) => {
  const programId = Number(req.params.programId);
  const existing = await one('SELECT id FROM saved_programs WHERE user_id = ? AND program_id = ?', req.user.id, programId);
  if (!existing) return res.json({ saved: false });
  await transaction(async () => {
    await run('DELETE FROM saved_programs WHERE id = ?', existing.id);
    await run('UPDATE affiliate_programs SET save_count = CASE WHEN save_count > 0 THEN save_count - 1 ELSE 0 END WHERE id = ?', programId);
  });
  res.json({ saved: false, message: 'Removed from saved programs.' });
}));

router.get('/applications', wrap(async (req, res) => {
  const rows = await many(
    `SELECT a.id, a.status, a.applied_at, a.updated_at, a.notes,
            p.id AS program_id, p.slug, p.brand_name, p.logo_url, p.commission_label, p.network, p.signup_url
       FROM applications a JOIN affiliate_programs p ON p.id = a.program_id
      WHERE a.user_id = ? ORDER BY a.applied_at DESC`,
    req.user.id
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      appliedAt: r.applied_at,
      updatedAt: r.updated_at,
      notes: r.notes,
      program: {
        id: r.program_id,
        slug: r.slug,
        brandName: r.brand_name,
        logoUrl: r.logo_url,
        commissionLabel: r.commission_label,
        network: r.network,
        signupUrl: r.signup_url,
      },
    })),
  });
}));

router.post('/applications', wrap(async (req, res) => {
  const programId = Number(req.body?.programId);
  const program = await one(
    `SELECT id, signup_url FROM affiliate_programs WHERE id = ? AND status = 'approved'`,
    programId
  );
  if (!program) return res.status(404).json({ error: 'Program not found or not open.' });
  const existing = await one('SELECT id FROM applications WHERE user_id = ? AND program_id = ?', req.user.id, programId);
  if (existing) return res.status(409).json({ error: 'You are already tracking an application for this program.', applicationId: existing.id });
  const now = nowIso();
  const applicationId = await insert(
    `INSERT INTO applications (user_id, program_id, status, applied_at, notes, updated_at) VALUES (?,?,?,?,?,?)`,
    req.user.id,
    programId,
    'pending',
    now,
    cleanString(req.body?.notes, 500) || null,
    now
  );
  res.status(201).json({
    id: applicationId,
    signupUrl: program.signup_url,
    message: 'Tracking added. Continue on the affiliate network to submit your real application.',
  });
}));

const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

router.patch('/applications/:id', wrap(async (req, res) => {
  const app = await one('SELECT * FROM applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  const status = cleanString(req.body?.status, 20);
  const notes = req.body?.notes === undefined ? app.notes : cleanString(req.body.notes, 500);
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const appliedAt = req.body?.appliedAt ? cleanString(req.body.appliedAt, 30) : app.applied_at;
  if (req.body?.appliedAt && Number.isNaN(new Date(appliedAt).getTime())) {
    return res.status(400).json({ error: 'Invalid application date.' });
  }
  await run(
    'UPDATE applications SET status = ?, notes = ?, applied_at = ?, updated_at = ? WHERE id = ?',
    status || app.status,
    notes,
    appliedAt,
    nowIso(),
    app.id
  );
  res.json({ ok: true, message: 'Application updated.' });
}));

router.delete('/applications/:id', wrap(async (req, res) => {
  const result = await run('DELETE FROM applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Application not found.' });
  res.json({ ok: true, message: 'Application removed.' });
}));

router.get('/profile', wrap(async (req, res) => {
  const user = await one('SELECT id, name, email, avatar_url, created_at FROM users WHERE id = ?', req.user.id);
  const profile = (await one('SELECT * FROM creator_profiles WHERE user_id = ?', req.user.id)) || {};
  let promo = [];
  try {
    promo = JSON.parse(profile.promo_methods || '[]');
  } catch {
    promo = [];
  }
  res.json({
    profile: {
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      website: profile.website || '',
      twitter: profile.twitter || '',
      linkedin: profile.linkedin || '',
      instagram: profile.instagram || '',
      youtube: profile.youtube || '',
      niche: profile.niche || '',
      audienceSize: profile.audience_size || '',
      country: profile.country || '',
      promoMethods: promo,
      bio: profile.bio || '',
      memberSince: user.created_at,
    },
  });
}));

router.put('/profile', wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  const name = cleanString(b.name, 80);
  if (name.length < 2) fields.name = 'Enter your name.';
  const urls = ['website', 'twitter', 'linkedin', 'instagram', 'youtube'];
  const values = {};
  urls.forEach((key) => {
    const value = cleanString(b[key], 300);
    if (value && !isHttpUrl(value)) fields[key] = 'Enter a full https:// URL.';
    values[key] = value;
  });
  const avatarUrl = cleanString(b.avatarUrl, 400);
  if (avatarUrl && !isHttpUrl(avatarUrl) && !/^\/(logos|images)\//.test(avatarUrl)) fields.avatarUrl = 'Enter a valid image URL.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });

  const now = nowIso();
  await transaction(async () => {
    await run('UPDATE users SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?', name, avatarUrl || null, now, req.user.id);
    await run(
      `UPDATE creator_profiles SET website = ?, twitter = ?, linkedin = ?, instagram = ?, youtube = ?, niche = ?,
              audience_size = ?, country = ?, promo_methods = ?, bio = ?, updated_at = ?
        WHERE user_id = ?`,
      values.website || null,
      values.twitter || null,
      values.linkedin || null,
      values.instagram || null,
      values.youtube || null,
      cleanString(b.niche, 80) || null,
      cleanString(b.audienceSize, 40) || null,
      cleanString(b.country, 60) || null,
      JSON.stringify(safeJsonArray(b.promoMethods)),
      cleanString(b.bio, 800) || null,
      now,
      req.user.id
    );
  });
  res.json({ ok: true, message: 'Profile saved.' });
}));

/* ---------------------------------------------------------------------------
   Creator-owned affiliate links.

   Creators paste their own affiliate URL (Amazon Associates, Etsy, any brand)
   and Affilink gives them a shareable /go/<slug> link that counts clicks and
   then redirects. Affilink never pays commission and never modifies the URL.
--------------------------------------------------------------------------- */

const OFFER_LIMIT = 50;

function serializeOffer(row) {
  return {
    id: row.id,
    slug: row.slug,
    shareUrl: `/go/${row.slug}`,
    brandName: row.brand_name,
    title: row.title,
    category: row.category,
    destinationUrl: row.destination_url,
    commissionNote: row.commission_note,
    description: row.description,
    clicks: row.clicks,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateOffer(body = {}) {
  const fields = {};
  const brandName = cleanString(body.brandName, 80);
  const title = cleanString(body.title, 120);
  const destinationUrl = cleanString(body.destinationUrl, 1000);
  const category = cleanString(body.category, 60);
  const commissionNote = cleanString(body.commissionNote, 120);
  const description = cleanString(body.description, 600);

  if (brandName.length < 2) fields.brandName = 'Enter the brand, e.g. Amazon Associates.';
  if (title.length < 4) fields.title = 'Give the link a name of at least 4 characters.';
  if (!isHttpUrl(destinationUrl)) fields.destinationUrl = 'Paste the full affiliate link from the brand, starting with https://';
  if (description.length > 600) fields.description = 'Keep the description under 600 characters.';

  return {
    fields,
    data: { brandName, title, destinationUrl, category, commissionNote, description },
    hasErrors: Object.keys(fields).length > 0,
  };
}

router.get('/offers', wrap(async (req, res) => {
  const rows = await many('SELECT * FROM creator_offers WHERE user_id = ? ORDER BY created_at DESC', req.user.id);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  res.json({ items: rows.map(serializeOffer), stats: { total: rows.length, clicks, active: rows.filter((r) => r.is_active).length } });
}));

router.post('/offers', wrap(async (req, res) => {
  const count = (await one('SELECT COUNT(*) AS c FROM creator_offers WHERE user_id = ?', req.user.id)).c;
  if (count >= OFFER_LIMIT) return res.status(400).json({ error: `You can keep up to ${OFFER_LIMIT} links. Delete one to add another.` });
  const { fields, data, hasErrors } = validateOffer(req.body || {});
  if (hasErrors) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });

  const now = nowIso();
  const slug = await uniqueSlug(`${data.brandName}-${data.title}`, 'creator_offers');
  const offerId = await insert(
    `INSERT INTO creator_offers (user_id, slug, brand_name, title, category, destination_url, commission_note, description, clicks, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,0,1,?,?)`,
    req.user.id,
    slug,
    data.brandName,
    data.title,
    data.category || null,
    data.destinationUrl,
    data.commissionNote || null,
    data.description || null,
    now,
    now
  );
  const row = await one('SELECT * FROM creator_offers WHERE id = ?', offerId);
  res.status(201).json({ offer: serializeOffer(row), message: 'Affiliate link created.' });
}));

router.put('/offers/:id', wrap(async (req, res) => {
  const existing = await one('SELECT * FROM creator_offers WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!existing) return res.status(404).json({ error: 'Link not found.' });
  const body = req.body || {};
  const merged = {
    brandName: body.brandName ?? existing.brand_name,
    title: body.title ?? existing.title,
    destinationUrl: body.destinationUrl ?? existing.destination_url,
    category: body.category ?? existing.category,
    commissionNote: body.commissionNote ?? existing.commission_note,
    description: body.description ?? existing.description,
  };
  const { fields, data, hasErrors } = validateOffer(merged);
  if (hasErrors) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });

  const isActive = body.isActive === undefined ? existing.is_active : body.isActive ? 1 : 0;
  await run(
    `UPDATE creator_offers SET brand_name = ?, title = ?, category = ?, destination_url = ?, commission_note = ?, description = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    data.brandName,
    data.title,
    data.category || null,
    data.destinationUrl,
    data.commissionNote || null,
    data.description || null,
    isActive,
    nowIso(),
    existing.id,
    req.user.id
  );
  res.json({ offer: serializeOffer(await one('SELECT * FROM creator_offers WHERE id = ?', existing.id)), message: 'Link updated.' });
}));

router.delete('/offers/:id', wrap(async (req, res) => {
  const result = await run('DELETE FROM creator_offers WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Link not found.' });
  res.json({ ok: true, message: 'Link deleted.' });
}));

export default router;
