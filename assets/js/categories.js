import { api, init, escapeHtml, toast } from './app.js';

init();

const grid = document.getElementById('categoryGrid');

api('/api/categories')
  .then(({ categories }) => {
    if (!categories.length) {
      grid.innerHTML = '<p class="text-muted">No categories yet.</p>';
      return;
    }
    grid.innerHTML = categories
      .map(
        (c) => `<a class="category-tile" href="/programs?category=${encodeURIComponent(c.slug)}" style="padding:26px">
          <span class="category-icon" style="width:46px;height:46px;font-size:1.25rem;background:${escapeHtml(c.accent)}14;color:${escapeHtml(c.accent)}">
            <i class="bi ${escapeHtml(c.icon)}"></i>
          </span>
          <span>
            <span class="category-name" style="font-size:1.05rem">${escapeHtml(c.name)}</span>
            <span class="category-count" style="display:block;margin-top:4px">${escapeHtml(c.description || '')}</span>
            <span class="badge badge-outline mt-2">${c.programCount} program${c.programCount === 1 ? '' : 's'}</span>
          </span>
          <i class="bi bi-arrow-up-right arrow"></i>
        </a>`
      )
      .join('');
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  })
  .catch((err) => {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i class="bi bi-cloud-slash"></i></div><h3>Could not load categories</h3><p>${escapeHtml(err.message)}</p></div>`;
    toast('Could not load categories.', 'error');
  });
