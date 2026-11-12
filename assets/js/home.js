import { api, init, programCard, escapeHtml, formatNumber, initials, toast } from './app.js';

init();

const featuredEl = document.querySelector('[data-featured-programs]');
const trendingEl = document.querySelector('[data-trending-programs]');
const recentEl = document.querySelector('[data-recent-programs]');
const categoryGrid = document.querySelector('[data-category-grid]');
const testimonialGrid = document.querySelector('[data-testimonials]');
const categorySelect = document.querySelector('[data-category-select]');

function setStats(stats) {
  document.querySelectorAll('[data-stat]').forEach((el) => {
    const key = el.dataset.stat;
    el.textContent = key === 'totalViews' ? formatNumber(stats[key]) : formatNumber(stats[key] || 0);
  });
}

function renderRecent(items) {
  recentEl.innerHTML = items
    .map(
      (p) => `<a class="dash-list-item" href="/programs/${escapeHtml(p.slug)}">
        <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="38" height="38" loading="lazy">
        <div class="info">
          <div class="t">${escapeHtml(p.brandName)}</div>
          <div class="s">${escapeHtml(p.commissionLabel)} · ${escapeHtml(p.category?.name || '')}</div>
        </div>
        <i class="bi bi-arrow-right arrow"></i>
      </a>`
    )
    .join('');
}

function renderCategories(categories) {
  const iconWrap = categoryGrid;
  iconWrap.innerHTML = categories
    .map(
      (c) => `<a class="category-tile" href="/programs?category=${encodeURIComponent(c.slug)}">
        <span class="category-icon" style="background:${escapeHtml(c.accent)}14;color:${escapeHtml(c.accent)}"><i class="bi ${escapeHtml(c.icon)}"></i></span>
        <span>
          <span class="category-name">${escapeHtml(c.name)}</span>
          <span class="category-count" style="display:block">${c.programCount} program${c.programCount === 1 ? '' : 's'}</span>
        </span>
        <i class="bi bi-arrow-up-right arrow"></i>
      </a>`
    )
    .join('');

  if (categorySelect) {
    categorySelect.innerHTML =
      '<option value="">All categories</option>' +
      categories.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
  }
}

function renderTestimonials(items) {
  if (!items.length) {
    testimonialGrid.innerHTML = '';
    return;
  }
  testimonialGrid.innerHTML = items
    .slice(0, 3)
    .map(
      (t) => `<figure class="testimonial" style="margin:0">
        <div class="stars" aria-label="${t.rating} out of 5">${'<i class="bi bi-star-fill"></i>'.repeat(t.rating)}</div>
        <blockquote>“${escapeHtml(t.quote)}”</blockquote>
        <figcaption class="testimonial-author">
          <span class="avatar">${escapeHtml(initials(t.name))}</span>
          <span>
            <span class="name" style="display:block">${escapeHtml(t.name)}</span>
            <span class="role">${escapeHtml(t.role)}</span>
          </span>
          <span class="badge badge-outline" style="margin-left:auto">Sample</span>
        </figcaption>
      </figure>`
    )
    .join('');
}

async function load() {
  try {
    const [home, cats, content] = await Promise.all([api('/api/home'), api('/api/categories'), api('/api/content')]);
    setStats(home.stats);
    const heroCount = document.querySelector('[data-hero-count]');
    if (heroCount) heroCount.textContent = String(home.stats.programs);
    featuredEl.innerHTML = home.featured.map((p) => programCard(p)).join('');
    featuredEl.setAttribute('aria-busy', 'false');
    trendingEl.innerHTML = home.trending.slice(0, 4).map((p) => programCard(p)).join('');
    renderRecent(home.recent);
    renderCategories(cats.categories);

    const heroTitle = document.querySelector('.hero h1');
    if (content.content.hero_title && content.content.hero_title !== 'Find Affiliate Programs Worth Promoting.') {
      heroTitle.textContent = content.content.hero_title;
    }
    const heroSub = document.querySelector('.hero-sub');
    if (content.content.hero_subtitle) heroSub.textContent = content.content.hero_subtitle;
    document.querySelectorAll('[data-content]').forEach((el) => {
      const value = content.content[el.dataset.content];
      if (value) el.textContent = value;
    });

    const testimonials = await api('/api/testimonials');
    renderTestimonials(testimonials.testimonials);
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  } catch (err) {
    console.error(err);
    featuredEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="icon"><i class="bi bi-cloud-slash"></i></div>
      <h3>Could not load programs</h3><p>${escapeHtml(err.message)}</p>
      <a class="btn btn-primary btn-sm" href="/">Try again</a></div>`;
    trendingEl.innerHTML = '';
    recentEl.innerHTML = '<p class="text-sm text-muted">Unable to load recent programs.</p>';
    toast('Could not load the directory. Please refresh.', 'error');
  }
}

load();
