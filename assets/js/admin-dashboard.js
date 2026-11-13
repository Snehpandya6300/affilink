import {
  api, init, escapeHtml, initials, formatDate, formatNumber, getMe, requireUserRedirect,
  toast, busy, showFormErrors, clearFormErrors, $, $$,
} from './app.js';
import { lineChart } from './charts.js';

init();

const TITLES = {
  overview: ['Overview', 'Platform health, submissions and directory activity.'],
  programs: ['Programs', 'Approve, edit, feature or remove affiliate listings.'],
  users: ['Users', 'Manage creator, brand and administrator accounts.'],
  categories: ['Categories', 'Structure the directory and its filters.'],
  testimonials: ['Testimonials', 'Curate the sample social proof shown on the homepage.'],
  reviews: ['Reviews', 'Moderate creator reviews before they appear publicly.'],
  content: ['Homepage content', 'Edit the marketing copy shown on the site.'],
  analytics: ['Analytics', 'Traffic, growth and category performance across the platform.'],
  messages: ['Messages', 'Contact form submissions from visitors.'],
};

const state = {
  programs: [],
  programStatus: '',
  programSearch: '',
  programPage: 1,
  categories: [],
  testimonials: [],
  overview: null,
};

function setView(view, updateUrl = true) {
  if (!TITLES[view]) view = 'overview';
  $$('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  $$('.side-link[data-view]').forEach((link) => link.classList.toggle('is-active', link.dataset.view === view));
  const [title, sub] = TITLES[view];
  $('[data-page-title]').textContent = title;
  $('[data-page-sub]').textContent = sub;
  if (updateUrl) window.history.replaceState({}, '', view === 'overview' ? '/admin' : `/admin?${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'programs') loadPrograms();
  if (view === 'users') loadUsers();
  if (view === 'categories') loadCategories();
  if (view === 'testimonials') loadTestimonials();
  if (view === 'reviews') loadReviews();
  if (view === 'content') loadContent();
  if (view === 'analytics') loadAnalytics();
  if (view === 'messages') loadMessages();
}

function currentView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.keys().next().value;
  return TITLES[view] ? view : 'overview';
}

/* ------------------------------ overview */
async function loadOverview() {
  try {
    const data = await api('/api/admin/overview');
    state.overview = data;
    Object.entries(data.counts).forEach(([key, value]) => {
      const el = document.querySelector(`[data-count="${key}"]`);
      if (el) el.textContent = ['views', 'clicks', 'users', 'programs'].includes(key) ? formatNumber(value) : value;
    });
    $('[data-count-pending]').textContent = data.counts.pending;
    $('[data-count-pending]').parentElement?.classList.toggle('has-badge', data.counts.pending > 0);

    const chartSeries = [
      { name: 'Views', color: '#6152f4', values: data.series.map((d) => d.value) },
    ];
    $('[data-page-sub]').textContent = 'Platform health, submissions and directory activity.';
    document.getElementById('overviewChart').innerHTML = lineChart({
      labels: data.series.map((d) => d.date.slice(5)),
      series: chartSeries,
      height: 210,
    });

    document.getElementById('pendingPreview').innerHTML = data.pending.length
      ? data.pending
          .slice(0, 4)
          .map(
            (p) => `<div class="dash-list-item" style="align-items:flex-start">
              <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="38" height="38" loading="lazy">
              <div class="info">
                <div class="t">${escapeHtml(p.brandName)}</div>
                <div class="s">${escapeHtml(p.commissionLabel)} · ${escapeHtml(p.category?.name || 'Uncategorised')}</div>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-primary btn-sm" type="button" data-approve="${p.id}">Approve</button>
                <button class="btn btn-ghost btn-sm" type="button" data-reject="${p.id}" data-name="${escapeHtml(p.brandName)}">Reject</button>
              </div>
            </div>`
          )
          .join('')
      : '<p class="text-sm text-muted mb-0">Nothing waiting for review. Nice.</p>';

    document.getElementById('topPrograms').innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Program</th><th>Views</th><th>Clicks</th><th>Saves</th><th></th></tr></thead>
      <tbody>${data.topPrograms
        .map(
          (p) => `<tr>
            <td><div class="cell-main"><img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="32" height="32" style="width:32px;height:32px;border-radius:8px">
              <div><div class="t">${escapeHtml(p.brandName)}</div><div class="s">${escapeHtml(p.category?.name || '')}</div></div></div></td>
            <td>${formatNumber(p.viewCount)}</td><td>${formatNumber(p.clickCount)}</td><td>${formatNumber(p.saveCount)}</td>
            <td><div class="row-actions"><a href="/programs/${escapeHtml(p.slug)}" target="_blank" rel="noopener">View</a></div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ programs */
async function loadPrograms() {
  const wrap = document.getElementById('adminPrograms');
  try {
    const params = new URLSearchParams();
    if (state.programStatus) params.set('status', state.programStatus);
    if (state.programSearch) params.set('search', state.programSearch);
    params.set('page', String(state.programPage));
    const data = await api(`/api/admin/programs?${params.toString()}`);
    state.programs = data.items;
    document.getElementById('programCountLabel').textContent = `${data.total} program${data.total === 1 ? '' : 's'}${state.programStatus ? ` · ${state.programStatus}` : ''}`;
    $$('[data-status-filter]').forEach((btn) => {
      btn.classList.toggle('btn-primary', btn.dataset.statusFilter === state.programStatus);
      btn.classList.toggle('btn-ghost', btn.dataset.statusFilter !== state.programStatus);
    });

    if (!data.items.length) {
      wrap.innerHTML = '<p class="text-sm text-muted">No programs match this filter.</p>';
      document.getElementById('adminPagination').innerHTML = '';
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Program</th><th>Status</th><th>Owner</th><th>Commission</th><th>Views</th><th>Created</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (p) => `<tr>
            <td><div class="cell-main">
              <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="34" height="34" style="width:34px;height:34px;border-radius:9px">
              <div><div class="t">${escapeHtml(p.brandName)}</div><div class="s">${escapeHtml(p.category?.name || 'Uncategorised')}${p.featured ? ' · featured' : ''}</div></div>
            </div></td>
            <td><span class="badge ${p.status === 'approved' ? 'badge-success' : p.status === 'pending' ? 'badge-warning' : 'badge-danger'}">${p.status}</span></td>
            <td class="text-xs">${escapeHtml(p.ownerEmail || 'Platform')}</td>
            <td>${escapeHtml(p.commissionLabel)}</td>
            <td>${formatNumber(p.viewCount)}</td>
            <td class="text-xs text-muted">${formatDate(p.createdAt)}</td>
            <td><div class="row-actions">
              ${p.status !== 'approved' ? `<button type="button" data-approve="${p.id}" title="Approve"><i class="bi bi-check2"></i></button>` : ''}
              ${p.status !== 'rejected' ? `<button type="button" data-reject="${p.id}" data-name="${escapeHtml(p.brandName)}" title="Reject"><i class="bi bi-x-lg"></i></button>` : ''}
              <button type="button" data-edit-program="${p.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button type="button" class="${p.featured ? 'danger' : ''}" data-feature="${p.id}" data-featured="${p.featured ? 1 : 0}" title="${p.featured ? 'Unfeature' : 'Feature'}"><i class="bi ${p.featured ? 'bi-star-fill' : 'bi-star'}"></i></button>
              <button type="button" class="danger" data-delete-program="${p.id}" data-name="${escapeHtml(p.brandName)}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
    renderAdminPagination(data);
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminPagination(data) {
  const el = document.getElementById('adminPagination');
  if (data.totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button type="button" data-admin-page="${data.page - 1}" ${data.page === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
    <span class="text-sm text-muted" style="padding:0 10px">Page ${data.page} of ${data.totalPages}</span>
    <button type="button" data-admin-page="${data.page + 1}" ${data.page === data.totalPages ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;
}

function openProgramModal(id) {
  const p = state.programs.find((x) => x.id === Number(id));
  if (!p) return toast('Program not found in this list. Refresh and try again.', 'error');
  $('#apId').value = p.id;
  $('#apTitle').value = p.title;
  $('#apDescription').value = p.description;
  $('#apCategory').innerHTML = state.categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${c.slug === p.category?.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  $('#apNetwork').value = p.network;
  $('#apCommission').value = p.commissionLabel;
  $('#apCookie').value = p.cookieDays;
  $('#apStatus').value = p.status;
  $('#apFeatured').checked = p.featured;
  $('#apReason').value = p.rejectionReason || '';
  const modalEl = $('#programModal');
  modalEl.querySelector('[data-form-alert]').hidden = true;
  new window.bootstrap.Modal(modalEl).show();
}

async function saveProgramModal() {
  const id = $('#apId').value;
  const alert = $('#programModal [data-form-alert]');
  alert.hidden = true;
  const status = $('#apStatus').value;
  const reason = $('#apReason').value.trim();
  if (status === 'rejected' && !reason) {
    alert.textContent = 'Add a rejection reason so the brand knows what to fix.';
    alert.hidden = false;
    return;
  }
  const body = {
    title: $('#apTitle').value.trim(),
    description: $('#apDescription').value.trim(),
    category: $('#apCategory').value,
    network: $('#apNetwork').value.trim(),
    commissionLabel: $('#apCommission').value.trim(),
    cookieDays: Number($('#apCookie').value),
    status,
    featured: $('#apFeatured').checked,
    rejectionReason: reason || undefined,
  };
  const btn = $('#apSave');
  busy(btn, true, 'Saving…');
  try {
    await api(`/api/admin/programs/${id}`, { method: 'PATCH', body });
    toast('Listing updated.', 'success');
    window.bootstrap.Modal.getInstance($('#programModal'))?.hide();
    loadPrograms();
    loadOverview();
  } catch (err) {
    alert.textContent = err.message;
    alert.hidden = false;
    toast(err.message, 'error');
  } finally {
    busy(btn, false);
  }
}

async function patchProgram(id, body, successMessage) {
  try {
    await api(`/api/admin/programs/${id}`, { method: 'PATCH', body });
    toast(successMessage || 'Program updated.', 'success');
    loadPrograms();
    loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ users */
async function loadUsers() {
  const wrap = document.getElementById('adminUsers');
  try {
    const role = document.getElementById('userRoleFilter').value;
    const search = document.getElementById('userSearch').value.trim();
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (search) params.set('search', search);
    const data = await api(`/api/admin/users?${params.toString()}`);
    if (!data.items.length) {
      wrap.innerHTML = '<p class="text-sm text-muted">No users match this filter.</p>';
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>User</th><th>Role</th><th>Activity</th><th>Joined</th><th>Status</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (u) => `<tr>
            <td><div class="cell-main">
              <span class="avatar avatar-sm">${escapeHtml(initials(u.name))}</span>
              <div><div class="t">${escapeHtml(u.name)}</div><div class="s">${escapeHtml(u.email)}${u.companyName ? ` · ${escapeHtml(u.companyName)}` : ''}</div></div>
            </div></td>
            <td><span class="badge badge-outline">${escapeHtml(u.role)}</span></td>
            <td class="text-xs">${u.programCount} programs · ${u.savedCount} saves · ${u.applicationCount} applications</td>
            <td class="text-xs text-muted">${formatDate(u.createdAt)}</td>
            <td><span class="status-dot ${u.status === 'active' ? 'status-approved' : 'status-rejected'}">${escapeHtml(u.status)}</span></td>
            <td><div class="row-actions">
              ${u.role !== 'admin' ? `<button type="button" data-suspend-user="${u.id}" data-status="${u.status}" title="${u.status === 'active' ? 'Suspend' : 'Reactivate'}"><i class="bi ${u.status === 'active' ? 'bi-pause-circle' : 'bi-play-circle'}"></i></button>
              <button type="button" class="danger" data-delete-user="${u.id}" data-name="${escapeHtml(u.name)}" title="Delete user"><i class="bi bi-trash3"></i></button>` : '<span class="text-xs text-muted">Protected</span>'}
            </div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

/* ------------------------------ categories */
async function loadCategories() {
  const wrap = document.getElementById('adminCategories');
  try {
    const data = await api('/api/admin/categories');
    state.categories = data.items;
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Category</th><th>Slug</th><th>Programs</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (c) => `<tr>
            <td><div class="cell-main"><span class="category-icon" style="width:32px;height:32px;font-size:.9rem;background:${escapeHtml(c.accent)}14;color:${escapeHtml(c.accent)}"><i class="bi ${escapeHtml(c.icon)}"></i></span>
              <div><div class="t">${escapeHtml(c.name)}</div><div class="s">${escapeHtml(c.description || '')}</div></div></div></td>
            <td class="text-xs text-muted">${escapeHtml(c.slug)}</td>
            <td>${c.programCount}</td>
            <td><div class="row-actions">
              <button type="button" data-edit-category="${c.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button type="button" class="danger" data-delete-category="${c.id}" data-name="${escapeHtml(c.name)}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function openCategoryModal(category = null) {
  $('#categoryModalTitle').textContent = category ? 'Edit category' : 'Add category';
  $('#catId').value = category?.id || '';
  $('#catName').value = category?.name || '';
  $('#catDescription').value = category?.description || '';
  $('#catIcon').value = category?.icon || 'bi-grid';
  $('#catAccent').value = category?.accent || '#6457f9';
  $('#categoryModal [data-form-alert]').hidden = true;
  new window.bootstrap.Modal($('#categoryModal')).show();
}

async function saveCategory() {
  const id = $('#catId').value;
  const alert = $('#categoryModal [data-form-alert]');
  alert.hidden = true;
  const body = {
    name: $('#catName').value.trim(),
    description: $('#catDescription').value.trim(),
    icon: $('#catIcon').value.trim(),
    accent: $('#catAccent').value,
  };
  if (body.name.length < 2) {
    alert.textContent = 'Category name is required.';
    alert.hidden = false;
    return;
  }
  const btn = $('#catSave');
  busy(btn, true, 'Saving…');
  try {
    if (id) await api(`/api/admin/categories/${id}`, { method: 'PUT', body });
    else await api('/api/admin/categories', { method: 'POST', body });
    toast(id ? 'Category updated.' : 'Category created.', 'success');
    window.bootstrap.Modal.getInstance($('#categoryModal'))?.hide();
    loadCategories();
    loadOverview();
  } catch (err) {
    alert.textContent = err.message;
    alert.hidden = false;
  } finally {
    busy(btn, false);
  }
}

/* ------------------------------ testimonials */
async function loadTestimonials() {
  const wrap = document.getElementById('adminTestimonials');
  try {
    const data = await api('/api/admin/testimonials');
    state.testimonials = data.items;
    if (!data.items.length) {
      wrap.innerHTML = '<p class="text-sm text-muted">No testimonials yet. Add one to show social proof on the homepage.</p>';
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Person</th><th>Quote</th><th>Rating</th><th>Status</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (t) => `<tr>
            <td><div class="cell-main"><span class="avatar avatar-sm">${escapeHtml(initials(t.name))}</span>
              <div><div class="t">${escapeHtml(t.name)}</div><div class="s">${escapeHtml(t.role)}</div></div></div></td>
            <td class="text-sm" style="max-width:360px">${escapeHtml(t.quote)}</td>
            <td><span class="stars">${'<i class="bi bi-star-fill"></i>'.repeat(t.rating)}</span></td>
            <td><span class="badge ${t.status === 'published' ? 'badge-success' : 'badge-outline'}">${escapeHtml(t.status)}</span></td>
            <td><div class="row-actions">
              <button type="button" data-edit-testimonial="${t.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button type="button" data-toggle-testimonial="${t.id}" data-status="${t.status}" title="${t.status === 'published' ? 'Hide' : 'Publish'}"><i class="bi ${t.status === 'published' ? 'bi-eye-slash' : 'bi-eye'}"></i></button>
              <button type="button" class="danger" data-delete-testimonial="${t.id}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function openTestimonialModal(t = null) {
  $('#testimonialModalTitle').textContent = t ? 'Edit testimonial' : 'Add testimonial';
  $('#tId').value = t?.id || '';
  $('#tName').value = t?.name || '';
  $('#tRole').value = t?.role || '';
  $('#tQuote').value = t?.quote || '';
  $('#tRating').value = String(t?.rating || 5);
  $('#tStatus').value = t?.status || 'published';
  $('#testimonialModal [data-form-alert]').hidden = true;
  new window.bootstrap.Modal($('#testimonialModal')).show();
}

async function saveTestimonial() {
  const id = $('#tId').value;
  const alert = $('#testimonialModal [data-form-alert]');
  const body = {
    name: $('#tName').value.trim(),
    role: $('#tRole').value.trim(),
    quote: $('#tQuote').value.trim(),
    rating: Number($('#tRating').value),
    status: $('#tStatus').value,
  };
  if (!body.name || !body.role || body.quote.length < 10) {
    alert.textContent = 'Name, role and a quote (10+ characters) are required.';
    alert.hidden = false;
    return;
  }
  alert.hidden = true;
  const btn = $('#tSave');
  busy(btn, true, 'Saving…');
  try {
    if (id) await api(`/api/admin/testimonials/${id}`, { method: 'PUT', body });
    else await api('/api/admin/testimonials', { method: 'POST', body });
    toast('Testimonial saved.', 'success');
    window.bootstrap.Modal.getInstance($('#testimonialModal'))?.hide();
    loadTestimonials();
  } catch (err) {
    alert.textContent = err.message;
    alert.hidden = false;
  } finally {
    busy(btn, false);
  }
}

/* ------------------------------ reviews */
async function loadReviews() {
  const wrap = document.getElementById('adminReviews');
  try {
    const status = document.getElementById('reviewStatusFilter').value;
    const data = await api(`/api/admin/reviews${status ? `?status=${status}` : ''}`);
    if (!data.items.length) {
      wrap.innerHTML = '<p class="text-sm text-muted">No reviews for this filter.</p>';
      return;
    }
    wrap.innerHTML = data.items
      .map(
        (r) => `<div style="padding:16px 0;border-top:1px solid var(--line)">
          <div class="flex items-center justify-between gap-3 wrap">
            <div class="flex items-center gap-2">
              <span class="avatar avatar-sm">${escapeHtml(initials(r.author))}</span>
              <div>
                <div class="text-sm fw-600">${escapeHtml(r.author)} <span class="text-muted text-xs">on ${escapeHtml(r.brand_name)}</span></div>
                <div class="text-xs text-muted">${formatDate(r.created_at)} · ${escapeHtml(r.status)}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="stars">${'<i class="bi bi-star-fill"></i>'.repeat(r.rating)}</span>
              ${r.status !== 'approved' ? `<button class="btn btn-ghost btn-sm" type="button" data-approve-review="${r.id}">Approve</button>` : ''}
              ${r.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" type="button" data-reject-review="${r.id}">Reject</button>` : ''}
              <button class="btn btn-ghost btn-sm" type="button" data-delete-review="${r.id}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div>
          </div>
          <p class="text-sm text-muted" style="margin:8px 0 0">${escapeHtml(r.body)}</p>
        </div>`
      )
      .join('');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

/* ------------------------------ content */
async function loadContent() {
  try {
    const data = await api('/api/admin/content');
    ['hero_title', 'hero_subtitle', 'brand_headline', 'brand_copy', 'announcement'].forEach((key) => {
      const input = document.querySelector(`#contentForm [name="${key}"]`);
      if (input) input.value = data.content[key] || '';
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ analytics */
async function loadAnalytics() {
  try {
    const data = await api('/api/admin/analytics');
    Object.entries(data.totals).forEach(([key, value]) => {
      const el = document.querySelector(`[data-analytics-total="${key}"]`);
      if (el) el.textContent = formatNumber(value);
    });
    document.getElementById('trafficChart').innerHTML = lineChart({
      labels: data.views.map((d) => d.date.slice(5)),
      series: [
        { name: 'Views', color: '#6152f4', values: data.views.map((d) => d.value) },
        { name: 'Clicks', color: '#16a34a', values: data.clicks.map((d) => d.value) },
      ],
      height: 230,
    });
    document.getElementById('growthChart').innerHTML = lineChart({
      labels: data.signups.map((d) => d.date.slice(5)),
      series: [
        { name: 'Signups', color: '#0ea5e9', values: data.signups.map((d) => d.value) },
        { name: 'Submissions', color: '#f59e0b', values: data.submissions.map((d) => d.value) },
      ],
      height: 220,
    });
    document.getElementById('topCategories').innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Category</th><th>Programs</th><th>Views</th><th>Clicks</th></tr></thead>
      <tbody>${data.topCategories
        .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${c.programs}</td><td>${formatNumber(c.views)}</td><td>${formatNumber(c.clicks)}</td></tr>`)
        .join('')}</tbody></table></div>`;
    document.getElementById('networkTable').innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Network</th><th>Programs</th><th>Clicks</th></tr></thead>
      <tbody>${data.networks
        .map((n) => `<tr><td>${escapeHtml(n.network)}</td><td>${n.programs}</td><td>${formatNumber(n.clicks)}</td></tr>`)
        .join('')}</tbody></table></div>`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ messages */
async function loadMessages() {
  const wrap = document.getElementById('adminMessages');
  try {
    const data = await api('/api/admin/messages');
    document.getElementById('messageCount').textContent = `${data.newCount} new · ${data.items.length} total`;
    if (!data.items.length) {
      wrap.innerHTML = '<p class="text-sm text-muted">No messages yet. The contact form on /contact writes here.</p>';
      return;
    }
    wrap.innerHTML = data.items
      .map(
        (m) => `<div style="padding:16px 0;border-top:1px solid var(--line)">
          <div class="flex items-center justify-between gap-3 wrap">
            <div>
              <div class="text-sm fw-600">${escapeHtml(m.name)} <span class="text-muted text-xs">· ${escapeHtml(m.email)}</span></div>
              <div class="text-xs text-muted">${escapeHtml(m.topic)} · ${formatDate(m.created_at)}</div>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge ${m.status === 'new' ? 'badge-warning' : 'badge-success'}">${escapeHtml(m.status)}</span>
              <button class="btn btn-ghost btn-sm" type="button" data-mark-message="${m.id}" data-status="${m.status}">${m.status === 'new' ? 'Mark handled' : 'Reopen'}</button>
              <button class="btn btn-ghost btn-sm" type="button" data-delete-message="${m.id}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div>
          </div>
          <p class="text-sm text-muted" style="margin:8px 0 0;white-space:pre-line">${escapeHtml(m.message)}</p>
        </div>`
      )
      .join('');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

/* ------------------------------ events */
document.addEventListener('click', async (event) => {
  const viewBtn = event.target.closest('.side-link[data-view], [data-view]');
  if (viewBtn && viewBtn.dataset.view && viewBtn.closest('.dash-shell')) {
    event.preventDefault();
    setView(viewBtn.dataset.view);
    return;
  }
  const approve = event.target.closest('[data-approve]');
  if (approve) return patchProgram(approve.dataset.approve, { status: 'approved' }, 'Program approved and published.');
  const reject = event.target.closest('[data-reject]');
  if (reject) {
    const reason = window.prompt(`Reason for rejecting ${reject.dataset.name}? The brand will see this.`, 'Missing affiliate signup URL.');
    if (reason === null) return;
    if (!reason.trim()) return toast('A rejection reason is required.', 'warning');
    return patchProgram(reject.dataset.reject, { status: 'rejected', rejectionReason: reason.trim() }, 'Program rejected and brand notified.');
  }
  const feature = event.target.closest('[data-feature]');
  if (feature) {
    const next = feature.dataset.featured === '1' ? false : true;
    return patchProgram(feature.dataset.feature, { featured: next }, next ? 'Program featured.' : 'Program removed from featured.');
  }
  const edit = event.target.closest('[data-edit-program]');
  if (edit) {
    if (!state.categories.length) {
      try {
        state.categories = (await api('/api/admin/categories')).items;
      } catch {
        /* ignore */
      }
    }
    return openProgramModal(edit.dataset.editProgram);
  }
  const del = event.target.closest('[data-delete-program]');
  if (del) {
    if (!window.confirm(`Delete “${del.dataset.name}” permanently? This also removes its analytics.`)) return;
    try {
      await api(`/api/admin/programs/${del.dataset.deleteProgram}`, { method: 'DELETE' });
      toast('Program deleted.', 'success');
      loadPrograms();
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const adminPage = event.target.closest('[data-admin-page]');
  if (adminPage && !adminPage.disabled) {
    state.programPage = Number(adminPage.dataset.adminPage);
    return loadPrograms();
  }
  const statusFilter = event.target.closest('[data-status-filter]');
  if (statusFilter) {
    state.programStatus = statusFilter.dataset.statusFilter;
    state.programPage = 1;
    return loadPrograms();
  }
  /* users */
  const suspend = event.target.closest('[data-suspend-user]');
  if (suspend) {
    const next = suspend.dataset.status === 'active' ? 'suspended' : 'active';
    try {
      await api(`/api/admin/users/${suspend.dataset.suspendUser}`, { method: 'PATCH', body: { status: next } });
      toast(next === 'suspended' ? 'User suspended.' : 'User reactivated.', 'success');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const delUser = event.target.closest('[data-delete-user]');
  if (delUser) {
    if (!window.confirm(`Delete user ${delUser.dataset.name}? Their saved programs, applications and listings will be removed.`)) return;
    try {
      await api(`/api/admin/users/${delUser.dataset.deleteUser}`, { method: 'DELETE' });
      toast('User deleted.', 'success');
      loadUsers();
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  /* categories */
  if (event.target.closest('[data-new-category]')) {
    state.categories = (await api('/api/admin/categories')).items;
    return openCategoryModal();
  }
  const editCat = event.target.closest('[data-edit-category]');
  if (editCat) return openCategoryModal(state.categories.find((c) => c.id === Number(editCat.dataset.editCategory)));
  const delCat = event.target.closest('[data-delete-category]');
  if (delCat) {
    if (!window.confirm(`Delete category “${delCat.dataset.name}”?`)) return;
    try {
      await api(`/api/admin/categories/${delCat.dataset.deleteCategory}`, { method: 'DELETE' });
      toast('Category deleted.', 'success');
      loadCategories();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  /* testimonials */
  if (event.target.closest('[data-new-testimonial]')) return openTestimonialModal();
  const editT = event.target.closest('[data-edit-testimonial]');
  if (editT) return openTestimonialModal(state.testimonials.find((t) => t.id === Number(editT.dataset.editTestimonial)));
  const toggleT = event.target.closest('[data-toggle-testimonial]');
  if (toggleT) {
    const t = state.testimonials.find((x) => x.id === Number(toggleT.dataset.toggleTestimonial));
    if (!t) return;
    try {
      await api(`/api/admin/testimonials/${t.id}`, { method: 'PUT', body: { ...t, status: t.status === 'published' ? 'hidden' : 'published' } });
      toast('Testimonial updated.', 'success');
      loadTestimonials();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const delT = event.target.closest('[data-delete-testimonial]');
  if (delT) {
    if (!window.confirm('Delete this testimonial?')) return;
    try {
      await api(`/api/admin/testimonials/${delT.dataset.deleteTestimonial}`, { method: 'DELETE' });
      toast('Testimonial deleted.', 'success');
      loadTestimonials();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  /* reviews */
  const reviewAction = event.target.closest('[data-approve-review],[data-reject-review]');
  if (reviewAction) {
    const id = reviewAction.dataset.approveReview || reviewAction.dataset.rejectReview;
    const status = reviewAction.dataset.approveReview ? 'approved' : 'rejected';
    try {
      await api(`/api/admin/reviews/${id}`, { method: 'PATCH', body: { status } });
      toast(`Review ${status}.`, 'success');
      loadReviews();
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const delReview = event.target.closest('[data-delete-review]');
  if (delReview) {
    if (!window.confirm('Delete this review permanently?')) return;
    try {
      await api(`/api/admin/reviews/${delReview.dataset.deleteReview}`, { method: 'DELETE' });
      toast('Review deleted.', 'success');
      loadReviews();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  /* messages */
  const markMsg = event.target.closest('[data-mark-message]');
  if (markMsg) {
    try {
      await api(`/api/admin/messages/${markMsg.dataset.markMessage}`, { method: 'PATCH', body: { status: markMsg.dataset.status === 'new' ? 'handled' : 'new' } });
      loadMessages();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const delMsg = event.target.closest('[data-delete-message]');
  if (delMsg) {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api(`/api/admin/messages/${delMsg.dataset.deleteMessage}`, { method: 'DELETE' });
      toast('Message deleted.', 'success');
      loadMessages();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
});

let userSearchTimer;
document.addEventListener('input', (event) => {
  if (event.target.id === 'programSearch') {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(() => {
      state.programSearch = event.target.value.trim();
      state.programPage = 1;
      loadPrograms();
    }, 300);
  }
  if (event.target.id === 'userSearch') {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(loadUsers, 300);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'userRoleFilter') loadUsers();
  if (event.target.id === 'reviewStatusFilter') loadReviews();
});

const contentForm = document.getElementById('contentForm');
if (contentForm) {
  contentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(contentForm);
    const body = {};
    ['hero_title', 'hero_subtitle', 'brand_headline', 'brand_copy', 'announcement'].forEach((key) => {
      body[key] = contentForm.elements[key].value.trim();
    });
    const submit = contentForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Saving…');
    try {
      await api('/api/admin/content', { method: 'PUT', body });
      toast('Homepage content updated.', 'success');
    } catch (err) {
      showFormErrors(contentForm, err.fields || {}, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });
}

document.getElementById('apSave')?.addEventListener('click', saveProgramModal);
document.getElementById('catSave')?.addEventListener('click', saveCategory);
document.getElementById('tSave')?.addEventListener('click', saveTestimonial);

/* ------------------------------ boot */
(async function boot() {
  const me = await getMe();
  if (!requireUserRedirect(me, 'admin')) return;
  const avatar = document.querySelector('[data-user-avatar]');
  if (avatar) avatar.innerHTML = escapeHtml(initials(me.name));
  document.querySelector('[data-user-name]').textContent = me.name;
  await loadOverview();
  try {
    state.categories = (await api('/api/admin/categories')).items;
  } catch {
    /* ignore */
  }
  setView(currentView(), false);
})();
