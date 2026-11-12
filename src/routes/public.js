import { Router } from 'express';
import { many, one, run, nowIso } from '../db.js';
import { listPrograms, facets, getProgramBySlug, platformStats, serializeProgram } from '../programs.js';
import { requireAuth } from '../auth.js';
import { cleanString, visitorHash } from '../security.js';

const router = Router();

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/stats', wrap(async (req, res) => {
  res.json({ stats: await platformStats(), demo: true });
}));

router.get('/categories', wrap(async (req, res) => {
  const rows = await many(
    `SELECT c.*, (SELECT COUNT(*) FROM affiliate_programs p WHERE p.category_id = c.id AND p.status='approved') AS program_count
       FROM categories c ORDER BY c.position, c.name`
  );
  res.json({
    categories: rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      icon: c.icon,
      accent: c.accent,
      programCount: c.program_count,
    })),
  });
}));

router.get('/testimonials', wrap(async (req, res) => {
  const rows = await many(`SELECT id, name, role, quote, avatar_url, rating, is_demo FROM testimonials WHERE status = 'published' ORDER BY id`);
  res.json({ testimonials: rows });
}));

router.get('/content', wrap(async (req, res) => {
  const rows = await many('SELECT key, value FROM site_content');
  res.json({ content: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}));

router.get('/programs', wrap(async (req, res) => {
  const result = await listPrograms({
    search: req.query.q,
    category: req.query.category,
    commissionType: req.query.commissionType,
    minCommission: req.query.minCommission,
    minCookie: req.query.cookie,
    network: req.query.network,
    paymentMethod: req.query.payment,
    sort: req.query.sort,
    page: req.query.page,
    perPage: req.query.perPage,
    featured: req.query.featured,
  });

  if (req.user) {
    const ids = result.items.map((p) => p.id);
    const saved = ids.length
      ? await many(`SELECT program_id FROM saved_programs WHERE user_id = ? AND program_id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids)
      : [];
    const savedSet = new Set(saved.map((s) => s.program_id));
    result.items.forEach((p) => {
      p.saved = savedSet.has(p.id);
    });
  }
  res.json({ ...result, facets: await facets() });
}));

router.get('/home', wrap(async (req, res) => {
  const featured = (
    await many(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent
         FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'approved' AND p.featured = 1
        ORDER BY (p.view_count + p.click_count * 4) DESC LIMIT 6`
    )
  ).map((r) => serializeProgram(r));
  const trending = (
    await many(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent
         FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'approved'
        ORDER BY (p.view_count + p.click_count * 4 + p.save_count * 6) DESC LIMIT 4`
    )
  ).map((r) => serializeProgram(r));
  const recent = (
    await many(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent
         FROM affiliate_programs p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'approved' ORDER BY p.created_at DESC LIMIT 4`
    )
  ).map((r) => serializeProgram(r));
  res.json({ featured, trending, recent, stats: await platformStats(), facets: await facets() });
}));

router.get('/programs/:slug', wrap(async (req, res) => {
  const program = await getProgramBySlug(req.params.slug, req.user?.id || null);
  if (!program || program.status !== 'approved') {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(404).json({ error: 'Program not found.' });
    }
  }
  res.json({ program });
}));

router.post('/programs/:slug/view', wrap(async (req, res) => {
  const program = await one(`SELECT id, brand_user_id, status FROM affiliate_programs WHERE slug = ?`, req.params.slug);
  if (!program || program.status !== 'approved') return res.status(404).json({ error: 'Program not found.' });
  if (req.user && (req.user.role === 'admin' || req.user.id === program.brand_user_id)) {
    return res.json({ recorded: false });
  }
  const visitor = visitorHash(req);
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const existing = await one(
    `SELECT id FROM program_views WHERE program_id = ? AND (user_id = ? OR visitor = ?) AND created_at >= ?`,
    program.id,
    req.user?.id || null,
    visitor,
    since
  );
  if (existing) return res.json({ recorded: false });
  await run(`INSERT INTO program_views (program_id, user_id, visitor, created_at) VALUES (?,?,?,?)`, program.id, req.user?.id || null, visitor, nowIso());
  await run(`UPDATE affiliate_programs SET view_count = view_count + 1 WHERE id = ?`, program.id);
  res.json({ recorded: true });
}));

router.post('/programs/:slug/click', wrap(async (req, res) => {
  const program = await one(`SELECT id, signup_url, status FROM affiliate_programs WHERE slug = ?`, req.params.slug);
  if (!program || program.status !== 'approved') return res.status(404).json({ error: 'Program not found.' });
  await run(`INSERT INTO outbound_clicks (program_id, user_id, created_at) VALUES (?,?,?)`, program.id, req.user?.id || null, nowIso());
  await run(`UPDATE affiliate_programs SET click_count = click_count + 1 WHERE id = ?`, program.id);
  res.json({ url: program.signup_url });
}));

router.post('/contact', wrap(async (req, res) => {
  const name = cleanString(req.body?.name, 80);
  const email = cleanString(req.body?.email, 160);
  const topic = cleanString(req.body?.topic, 40) || 'General';
  const message = cleanString(req.body?.message, 2000);
  const fields = {};
  if (name.length < 2) fields.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) fields.email = 'Enter a valid email address.';
  if (message.length < 20) fields.message = 'Tell us a little more (20+ characters).';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });
  const recent = await one('SELECT id FROM contact_messages WHERE email = ? AND created_at >= ?', email, new Date(Date.now() - 60_000).toISOString());
  if (recent) return res.status(429).json({ error: 'Please wait a moment before sending another message.' });
  await run(
    'INSERT INTO contact_messages (name, email, topic, message, status, created_at) VALUES (?,?,?,?,?,?)',
    name,
    email,
    topic,
    message,
    'new',
    nowIso()
  );
  res.status(201).json({ message: 'Thanks — your message has been received. We reply within two business days.' });
}));

router.post('/programs/:slug/reviews', requireAuth('creator', 'brand', 'admin'), wrap(async (req, res) => {
  const program = await one(`SELECT id FROM affiliate_programs WHERE slug = ? AND status = 'approved'`, req.params.slug);
  if (!program) return res.status(404).json({ error: 'Program not found.' });
  const rating = Number(req.body?.rating);
  const body = cleanString(req.body?.body, 1000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
  if (body.length < 15) return res.status(400).json({ error: 'Review must be at least 15 characters.' });
  const recent = await one(
    `SELECT id FROM reviews WHERE program_id = ? AND user_id = ? AND created_at >= ?`,
    program.id,
    req.user.id,
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  );
  if (recent) return res.status(429).json({ error: 'You already reviewed this program this week.' });
  await run(
    `INSERT INTO reviews (program_id, user_id, author, rating, body, status, created_at) VALUES (?,?,?,?,?,?,?)`,
    program.id,
    req.user.id,
    req.user.name,
    rating,
    body,
    'pending',
    nowIso()
  );
  res.status(201).json({ message: 'Thanks — your review is awaiting moderation.' });
}));

export default router;
