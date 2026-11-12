import { Router } from 'express';
import { many, one, run, transaction, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { serializeProgram } from '../programs.js';
import { cleanString, slugify } from '../security.js';

const router = Router();
router.use(requireAuth('admin'));

const PROGRAM_SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.accent AS category_accent,
         u.email AS owner_email
    FROM affiliate_programs p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.brand_user_id
`;

function daySeries(sql, days = 30) {
  const rows = many(sql, new Date(Date.now() - (days - 1) * 86400000).toISOString());
  const map = new Map(rows.map((r) => [r.day, r.c]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: key, value: map.get(key) || 0 });
  }
  return out;
}

router.get('/overview', (req, res) => {
  const counts = {
    users: one('SELECT COUNT(*) AS c FROM users').c,
    creators: one(`SELECT COUNT(*) AS c FROM users WHERE role = 'creator'`).c,
    brands: one(`SELECT COUNT(*) AS c FROM users WHERE role = 'brand'`).c,
    programs: one('SELECT COUNT(*) AS c FROM affiliate_programs').c,
    pending: one(`SELECT COUNT(*) AS c FROM affiliate_programs WHERE status = 'pending'`).c,
    approved: one(`SELECT COUNT(*) AS c FROM affiliate_programs WHERE status = 'approved'`).c,
    rejected: one(`SELECT COUNT(*) AS c FROM affiliate_programs WHERE status = 'rejected'`).c,
    views: one('SELECT COALESCE(SUM(view_count),0) AS c FROM affiliate_programs').c,
    clicks: one('SELECT COALESCE(SUM(click_count),0) AS c FROM affiliate_programs').c,
    saves: one('SELECT COUNT(*) AS c FROM saved_programs').c,
    applications: one('SELECT COUNT(*) AS c FROM applications').c,
    categories: one('SELECT COUNT(*) AS c FROM categories').c,
    reviewsPending: one(`SELECT COUNT(*) AS c FROM reviews WHERE status = 'pending'`).c,
  };
  const pending = many(`${PROGRAM_SELECT} WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 6`).map((r) =>
    serializeProgram(r, { ownerEmail: r.owner_email })
  );
  const topPrograms = many(`${PROGRAM_SELECT} WHERE p.status = 'approved' ORDER BY p.view_count DESC LIMIT 5`).map((r) =>
    serializeProgram(r)
  );
  const series = daySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM program_views WHERE created_at >= ? GROUP BY day`, 30);
  res.json({ counts, pending, topPrograms, series, user: req.user });
});

router.get('/programs', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const search = cleanString(req.query.search, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const perPage = 12;
  const where = [];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(p.brand_name LIKE ? OR p.title LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM affiliate_programs p LEFT JOIN users u ON u.id = p.brand_user_id ${clause}`, ...params).c;
  const rows = many(
    `${PROGRAM_SELECT} ${clause} ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage
  );
  res.json({
    items: rows.map((r) => serializeProgram(r, { ownerEmail: r.owner_email })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  });
});

router.patch('/programs/:id', (req, res) => {
  const program = one('SELECT * FROM affiliate_programs WHERE id = ?', Number(req.params.id));
  if (!program) return res.status(404).json({ error: 'Program not found.' });
  const status = cleanString(req.body?.status, 20) || program.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const reason = cleanString(req.body?.rejectionReason, 400);
  if (status === 'rejected' && !reason) return res.status(400).json({ error: 'Add a reason so the brand knows what to fix.' });
  const featured = req.body?.featured === undefined ? program.featured : req.body.featured ? 1 : 0;
  const now = nowIso();

  // Optional inline edits from the admin listing editor.
  const edit = {};
  if (typeof req.body?.title === 'string') {
    const title = cleanString(req.body.title, 120);
    if (title.length < 4) return res.status(400).json({ error: 'Program title is too short.' });
    edit.title = title;
  }
  if (typeof req.body?.description === 'string') {
    const description = cleanString(req.body.description, 2000);
    if (description.length < 30) return res.status(400).json({ error: 'Description must be at least 30 characters.' });
    edit.description = description;
  }
  if (typeof req.body?.commissionLabel === 'string') {
    const label = cleanString(req.body.commissionLabel, 100);
    if (!label) return res.status(400).json({ error: 'Commission label is required.' });
    edit.commission_label = label;
  }
  if (req.body?.cookieDays !== undefined) {
    const days = Number(req.body.cookieDays);
    if (!Number.isFinite(days) || days < 1 || days > 730) return res.status(400).json({ error: 'Cookie duration must be 1–730 days.' });
    edit.cookie_days = Math.round(days);
  }
  if (typeof req.body?.network === 'string') {
    const network = cleanString(req.body.network, 60);
    if (!network) return res.status(400).json({ error: 'Network is required.' });
    edit.network = network;
  }
  if (req.body?.category !== undefined) {
    const cat = one('SELECT id FROM categories WHERE slug = ?', cleanString(req.body.category, 60));
    if (!cat) return res.status(400).json({ error: 'Invalid category.' });
    edit.category_id = cat.id;
  }

  transaction(() => {
    run(
      `UPDATE affiliate_programs SET status = ?, featured = ?, rejection_reason = ?, updated_at = ?, approved_at = ? WHERE id = ?`,
      status,
      featured,
      status === 'rejected' ? reason : status === 'approved' ? null : program.rejection_reason,
      now,
      status === 'approved' ? program.approved_at || now : program.approved_at,
      program.id
    );
    if (Object.keys(edit).length) {
      const columns = Object.keys(edit)
        .map((key) => `${key} = ?`)
        .join(', ');
      run(`UPDATE affiliate_programs SET ${columns} WHERE id = ?`, ...Object.values(edit), program.id);
    }
    run('DELETE FROM featured_programs WHERE program_id = ?', program.id);
    if (featured && status === 'approved') {
      run('INSERT INTO featured_programs (program_id, position, created_at) VALUES (?,?,?)', program.id, 0, now);
    }
  });
  res.json({ message: `Program ${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'moved to pending'}.` });
});

router.delete('/programs/:id', (req, res) => {
  const result = run('DELETE FROM affiliate_programs WHERE id = ?', Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Program not found.' });
  res.json({ message: 'Program deleted.' });
});

router.get('/users', (req, res) => {
  const role = ['creator', 'brand', 'admin'].includes(req.query.role) ? req.query.role : null;
  const search = cleanString(req.query.search, 100);
  const where = [];
  const params = [];
  if (role) {
    where.push('u.role = ?');
    params.push(role);
  }
  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = many(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
            (SELECT COUNT(*) FROM affiliate_programs p WHERE p.brand_user_id = u.id) AS program_count,
            (SELECT COUNT(*) FROM saved_programs s WHERE s.user_id = u.id) AS saved_count,
            (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id) AS application_count,
            bp.company_name
       FROM users u LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       ${clause} ORDER BY u.created_at DESC LIMIT 200`,
    ...params
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
      programCount: r.program_count,
      savedCount: r.saved_count,
      applicationCount: r.application_count,
      companyName: r.company_name,
    })),
  });
});

router.patch('/users/:id', (req, res) => {
  const user = one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const status = cleanString(req.body?.status, 20) || user.status;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (user.id === req.user.id && status === 'suspended') return res.status(400).json({ error: 'You cannot suspend your own account.' });
  transaction(() => {
    run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), user.id);
    if (status === 'suspended') run('DELETE FROM sessions WHERE user_id = ?', user.id);
  });
  res.json({ message: status === 'suspended' ? 'User suspended.' : 'User reactivated.' });
});

router.delete('/users/:id', (req, res) => {
  const user = one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (user.role === 'admin' && one(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).c <= 1) {
    return res.status(400).json({ error: 'At least one administrator must remain.' });
  }
  run('DELETE FROM users WHERE id = ?', user.id);
  res.json({ message: 'User deleted.' });
});

router.get('/categories', (req, res) => {
  const rows = many(
    `SELECT c.*, (SELECT COUNT(*) FROM affiliate_programs p WHERE p.category_id = c.id) AS program_count
       FROM categories c ORDER BY c.position, c.name`
  );
  res.json({
    items: rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      icon: c.icon,
      accent: c.accent,
      position: c.position,
      programCount: c.program_count,
    })),
  });
});

router.post('/categories', (req, res) => {
  const name = cleanString(req.body?.name, 60);
  if (name.length < 2) return res.status(400).json({ error: 'Category name is required.', fields: { name: 'Required.' } });
  const slug = slugify(req.body?.slug || name, 'category');
  if (one('SELECT id FROM categories WHERE slug = ?', slug)) return res.status(409).json({ error: 'A category with that slug already exists.' });
  const { lastInsertRowid } = run(
    `INSERT INTO categories (slug, name, description, icon, accent, position, created_at) VALUES (?,?,?,?,?,?,?)`,
    slug,
    name,
    cleanString(req.body?.description, 200) || null,
    cleanString(req.body?.icon, 40) || 'bi-grid',
    cleanString(req.body?.accent, 20) || '#6457f9',
    Number(req.body?.position) || 0,
    nowIso()
  );
  res.status(201).json({ id: lastInsertRowid, message: 'Category created.' });
});

router.put('/categories/:id', (req, res) => {
  const cat = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  const name = cleanString(req.body?.name, 60) || cat.name;
  run(
    'UPDATE categories SET name = ?, description = ?, icon = ?, accent = ?, position = ? WHERE id = ?',
    name,
    req.body?.description === undefined ? cat.description : cleanString(req.body.description, 200),
    cleanString(req.body?.icon, 40) || cat.icon,
    cleanString(req.body?.accent, 20) || cat.accent,
    req.body?.position === undefined ? cat.position : Number(req.body.position) || 0,
    cat.id
  );
  res.json({ message: 'Category updated.' });
});

router.delete('/categories/:id', (req, res) => {
  const cat = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  const count = one('SELECT COUNT(*) AS c FROM affiliate_programs WHERE category_id = ?', cat.id).c;
  if (count > 0) return res.status(400).json({ error: `Move the ${count} program(s) in this category before deleting it.` });
  run('DELETE FROM categories WHERE id = ?', cat.id);
  res.json({ message: 'Category deleted.' });
});

router.get('/testimonials', (req, res) => {
  res.json({ items: many('SELECT * FROM testimonials ORDER BY created_at DESC') });
});

router.post('/testimonials', (req, res) => {
  const name = cleanString(req.body?.name, 80);
  const role = cleanString(req.body?.role, 100);
  const quote = cleanString(req.body?.quote, 500);
  if (!name || !role || quote.length < 10) return res.status(400).json({ error: 'Name, role and a quote are required.' });
  const { lastInsertRowid } = run(
    `INSERT INTO testimonials (name, role, quote, avatar_url, rating, status, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    name,
    role,
    quote,
    cleanString(req.body?.avatarUrl, 300) || null,
    Math.min(Math.max(Number(req.body?.rating) || 5, 1), 5),
    req.body?.status === 'hidden' ? 'hidden' : 'published',
    1,
    nowIso()
  );
  res.status(201).json({ id: lastInsertRowid, message: 'Testimonial added.' });
});

router.put('/testimonials/:id', (req, res) => {
  const t = one('SELECT * FROM testimonials WHERE id = ?', Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Testimonial not found.' });
  run(
    'UPDATE testimonials SET name = ?, role = ?, quote = ?, status = ?, rating = ? WHERE id = ?',
    cleanString(req.body?.name, 80) || t.name,
    cleanString(req.body?.role, 100) || t.role,
    cleanString(req.body?.quote, 500) || t.quote,
    req.body?.status === 'hidden' ? 'hidden' : 'published',
    Math.min(Math.max(Number(req.body?.rating) || t.rating, 1), 5),
    t.id
  );
  res.json({ message: 'Testimonial updated.' });
});

router.delete('/testimonials/:id', (req, res) => {
  const result = run('DELETE FROM testimonials WHERE id = ?', Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Testimonial not found.' });
  res.json({ message: 'Testimonial deleted.' });
});

const CONTENT_KEYS = ['hero_title', 'hero_subtitle', 'brand_headline', 'brand_copy', 'announcement'];

router.get('/content', (req, res) => {
  const rows = many('SELECT key, value FROM site_content');
  const content = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  CONTENT_KEYS.forEach((k) => {
    if (!(k in content)) content[k] = '';
  });
  res.json({ content, editableKeys: CONTENT_KEYS });
});

router.put('/content', (req, res) => {
  const body = req.body || {};
  const now = nowIso();
  transaction(() => {
    for (const key of CONTENT_KEYS) {
      if (!(key in body)) continue;
      const value = cleanString(body[key], 1000);
      const existing = one('SELECT key FROM site_content WHERE key = ?', key);
      if (existing) run('UPDATE site_content SET value = ?, updated_at = ? WHERE key = ?', value, now, key);
      else run('INSERT INTO site_content (key, value, updated_at) VALUES (?,?,?)', key, value, now);
    }
  });
  res.json({ message: 'Homepage content updated.' });
});

router.get('/reviews', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const rows = many(
    `SELECT r.*, p.slug, p.brand_name FROM reviews r JOIN affiliate_programs p ON p.id = r.program_id
      ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 100`,
    ...(status ? [status] : [])
  );
  res.json({ items: rows });
});

router.patch('/reviews/:id', (req, res) => {
  const review = one('SELECT * FROM reviews WHERE id = ?', Number(req.params.id));
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  const status = cleanString(req.body?.status, 20);
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  run('UPDATE reviews SET status = ? WHERE id = ?', status, review.id);
  res.json({ message: `Review ${status}.` });
});

router.delete('/reviews/:id', (req, res) => {
  const result = run('DELETE FROM reviews WHERE id = ?', Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Review not found.' });
  res.json({ message: 'Review deleted.' });
});

router.get('/messages', (req, res) => {
  const rows = many('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
  res.json({
    items: rows,
    newCount: rows.filter((r) => r.status === 'new').length,
  });
});

router.patch('/messages/:id', (req, res) => {
  const msg = one('SELECT * FROM contact_messages WHERE id = ?', Number(req.params.id));
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  const status = req.body?.status === 'new' ? 'new' : 'handled';
  run('UPDATE contact_messages SET status = ? WHERE id = ?', status, msg.id);
  res.json({ message: status === 'handled' ? 'Marked as handled.' : 'Moved back to new.' });
});

router.delete('/messages/:id', (req, res) => {
  const result = run('DELETE FROM contact_messages WHERE id = ?', Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Message not found.' });
  res.json({ message: 'Message deleted.' });
});

router.get('/analytics', (req, res) => {
  const signups = daySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM users WHERE created_at >= ? GROUP BY day`);
  const submissions = daySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM affiliate_programs WHERE created_at >= ? GROUP BY day`);
  const views = daySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM program_views WHERE created_at >= ? GROUP BY day`);
  const clicks = daySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM outbound_clicks WHERE created_at >= ? GROUP BY day`);
  const topCategories = many(
    `SELECT c.name, c.slug, COUNT(p.id) AS programs, COALESCE(SUM(p.view_count),0) AS views,
            COALESCE(SUM(p.click_count),0) AS clicks
       FROM categories c LEFT JOIN affiliate_programs p ON p.category_id = c.id AND p.status = 'approved'
      GROUP BY c.id ORDER BY views DESC`
  );
  const topPrograms = many(
    `SELECT brand_name, slug, view_count, click_count, save_count FROM affiliate_programs
      WHERE status = 'approved' ORDER BY view_count DESC LIMIT 8`
  );
  const networks = many(
    `SELECT network, COUNT(*) AS programs, COALESCE(SUM(click_count),0) AS clicks
       FROM affiliate_programs WHERE status = 'approved' GROUP BY network ORDER BY clicks DESC LIMIT 8`
  );
  res.json({
    signups,
    submissions,
    views,
    clicks,
    topCategories,
    topPrograms,
    networks,
    totals: {
      views: one('SELECT COALESCE(SUM(view_count),0) AS c FROM affiliate_programs').c,
      clicks: one('SELECT COALESCE(SUM(click_count),0) AS c FROM affiliate_programs').c,
      users: one('SELECT COUNT(*) AS c FROM users').c,
      programs: one('SELECT COUNT(*) AS c FROM affiliate_programs').c,
    },
  });
});

export default router;
