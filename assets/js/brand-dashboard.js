import {
  api, init, escapeHtml, initials, formatDate, formatNumber, getMe, requireUserRedirect,
  toast, busy, showFormErrors, clearFormErrors, emptyState, $, $$,
} from './app.js';
import { lineChart } from './charts.js';

init();

const TITLES = {
  overview: ['Overview', 'Track how your listings perform and keep your program details current.'],
  programs: ['My programs', 'Manage listings, update terms and see review status.'],
  analytics: ['Listing analytics', 'Views, outbound clicks and saves for each of your programs.'],
  settings: ['Account settings', 'Brand profile, contact details and password.'],
};

const state = { user: null, programs: [], selectedAnalytics: null };

function currentView() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('programs')) return 'programs';
  if (params.has('analytics')) return 'analytics';
  if (params.has('settings')) return 'settings';
  const view = params.get('view');
  return TITLES[view] ? view : 'overview';
}

function setView(view, updateUrl = true) {
  if (!TITLES[view]) view = 'overview';
  $$('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  $$('.side-link[data-view]').forEach((link) => link.classList.toggle('is-active', link.dataset.view === view));
  const [title, sub] = TITLES[view];
  $('[data-page-title]').textContent = title;
  $('[data-page-sub]').textContent = sub;
  if (updateUrl) window.history.replaceState({}, '', view === 'overview' ? '/brand/dashboard' : `/brand/dashboard?${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'analytics') loadAnalytics(state.selectedAnalytics);
  if (view === 'settings') loadProfile();
  if (view === 'programs') loadPrograms();
}

function statusBadge(status) {
  const map = { approved: 'badge-success', pending: 'badge-warning', rejected: 'badge-danger' };
  return `<span class="badge ${map[status] || 'badge-outline'}">${escapeHtml(status)}</span>`;
}

function programItem(p) {
  return `<a class="dash-list-item" href="/programs/${escapeHtml(p.slug)}">
    <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="38" height="38" loading="lazy">
    <div class="info">
      <div class="t">${escapeHtml(p.title)}</div>
      <div class="s">${escapeHtml(p.commissionLabel)} · ${p.viewCount} views · ${p.clickCount} clicks</div>
    </div>
    ${statusBadge(p.status)}
  </a>`;
}

async function loadOverview() {
  try {
    const data = await api('/api/brand/overview');
    state.programs = data.programs;
    state.user = { ...(data.user || {}), ...(state.user || {}) };
    $('[data-count-programs]').textContent = data.stats.total;
    ['total', 'approved', 'pending', 'views', 'clicks', 'clickRate'].forEach((key) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (!el) return;
      el.textContent = key === 'views' || key === 'clicks' ? formatNumber(data.stats[key]) : key === 'clickRate' ? `${data.stats.clickRate}%` : data.stats[key];
    });
    const labels = data.series.map((d) => d.date.slice(5));
    document.getElementById('overviewChart').innerHTML = lineChart({
      labels,
      series: [
        { name: 'Views', color: '#6152f4', values: data.series.map((d) => d.views) },
        { name: 'Clicks', color: '#16a34a', values: data.series.map((d) => d.clicks) },
      ],
    });
    document.getElementById('programsPreview').innerHTML = data.programs.length
      ? data.programs.slice(0, 4).map(programItem).join('')
      : '<p class="text-sm text-muted mb-0">No programs yet. Add your first listing.</p>';
    document.getElementById('brandReviews').innerHTML = data.reviews.length
      ? data.reviews
          .map(
            (r) => `<div class="review-item" style="padding:12px 0">
              <div class="review-head"><span class="review-author">${escapeHtml(r.author)}</span><span class="text-xs text-muted">${formatDate(r.created_at)}</span></div>
              <div class="stars">${'<i class="bi bi-star-fill"></i>'.repeat(r.rating)}</div>
              <p class="review-body" style="margin-top:6px">${escapeHtml(r.body)}</p>
            </div>`
          )
          .join('')
      : '<p class="text-sm text-muted mb-0">No reviews on your listings yet.</p>';
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadPrograms() {
  const wrap = document.getElementById('programsTable');
  try {
    const data = await api('/api/brand/programs');
    state.programs = data.items;
    $('[data-count-programs]').textContent = data.items.length;
    if (!data.items.length) {
      wrap.innerHTML = emptyState('No programs listed', 'Submit your affiliate program and it will appear here while it waits for review.', '<a class="btn btn-primary btn-sm" href="/brand/programs/new">Add your first program</a>');
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Program</th><th>Status</th><th>Commission</th><th>Views</th><th>Clicks</th><th>Updated</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (p) => `<tr>
            <td><div class="cell-main">
              <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="34" height="34" style="width:34px;height:34px;border-radius:9px">
              <div><div class="t">${escapeHtml(p.brandName)}</div><div class="s">${escapeHtml(p.category?.name || '')}</div></div>
            </div></td>
            <td>${statusBadge(p.status)}${p.status === 'rejected' && p.rejectionReason ? `<div class="text-xs" style="color:var(--danger);max-width:200px;margin-top:4px">${escapeHtml(p.rejectionReason)}</div>` : ''}</td>
            <td>${escapeHtml(p.commissionLabel)}</td>
            <td>${formatNumber(p.viewCount)}</td>
            <td>${formatNumber(p.clickCount)}</td>
            <td class="text-xs text-muted">${formatDate(p.updatedAt)}</td>
            <td><div class="row-actions">
              <a href="/brand/programs/${p.id}/edit">Edit</a>
              ${p.status === 'approved' ? `<a href="/programs/${escapeHtml(p.slug)}" target="_blank" rel="noopener">View</a>` : ''}
              <button type="button" data-analytics-program="${p.id}" title="Analytics"><i class="bi bi-graph-up"></i></button>
              <button type="button" class="danger" data-delete-program="${p.id}" data-name="${escapeHtml(p.title)}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div></td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function loadAnalytics(programId = null) {
  const select = document.getElementById('analyticsProgram');
  try {
    if (!state.programs.length) {
      const data = await api('/api/brand/programs');
      state.programs = data.items;
    }
    if (!state.programs.length) {
      select.innerHTML = '<option>No programs</option>';
      document.getElementById('analyticsChart').innerHTML = '<p class="text-sm text-muted">Add a program to see analytics.</p>';
      return;
    }
    select.innerHTML = state.programs.map((p) => `<option value="${p.id}" ${Number(programId) === p.id ? 'selected' : ''}>${escapeHtml(p.brandName)} — ${escapeHtml(p.title)}</option>`).join('');
    const id = Number(programId) || Number(select.value) || state.programs[0].id;
    const data = await api(`/api/brand/programs/${id}/analytics`);
    $$('[data-analytics]').forEach((el) => {
      const key = el.dataset.analytics;
      el.textContent = key === 'ctr' ? `${data.ctr}%` : formatNumber(data.totals[key]);
    });
    document.getElementById('analyticsChart').innerHTML = lineChart({
      labels: data.series.map((d) => d.date.slice(5)),
      series: [
        { name: 'Views', color: '#6152f4', values: data.series.map((d) => d.views) },
        { name: 'Clicks', color: '#16a34a', values: data.series.map((d) => d.clicks) },
      ],
      height: 220,
    });
    state.selectedAnalytics = id;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadProfile() {
  try {
    const { profile } = await api('/api/brand/profile');
    const form = document.getElementById('brandProfileForm');
    form.elements.name.value = profile.name || '';
    form.elements.companyName.value = profile.companyName || '';
    form.elements.contactEmail.value = profile.contactEmail || '';
    form.elements.country.value = profile.country || '';
    form.elements.website.value = profile.website || '';
    form.elements.logoUrl.value = profile.logoUrl || '';
    form.elements.about.value = profile.about || '';
    $('[data-brand-name]').textContent = profile.companyName || profile.name;
    $('[data-brand-email]').textContent = profile.contactEmail || profile.email;
    const avatar = $('[data-brand-avatar]');
    if (profile.logoUrl) avatar.innerHTML = `<img src="${escapeHtml(profile.logoUrl)}" alt="" onerror="this.remove()">`;
    else avatar.textContent = initials(profile.companyName || profile.name);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* events */
document.addEventListener('click', async (event) => {
  const viewBtn = event.target.closest('.side-link[data-view], [data-view]');
  if (viewBtn && viewBtn.dataset.view && viewBtn.closest('.dash-shell')) {
    event.preventDefault();
    setView(viewBtn.dataset.view);
    return;
  }
  const analyticsBtn = event.target.closest('[data-analytics-program]');
  if (analyticsBtn) {
    state.selectedAnalytics = Number(analyticsBtn.dataset.analyticsProgram);
    setView('analytics');
    return;
  }
  const delBtn = event.target.closest('[data-delete-program]');
  if (delBtn) {
    if (!window.confirm(`Delete “${delBtn.dataset.name}”? This removes the listing and its analytics permanently.`)) return;
    try {
      await api(`/api/brand/programs/${delBtn.dataset.deleteProgram}`, { method: 'DELETE' });
      toast('Program deleted.', 'success');
      loadPrograms();
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'analyticsProgram') loadAnalytics(Number(event.target.value));
});

const profileForm = document.getElementById('brandProfileForm');
if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(profileForm);
    const body = {
      name: profileForm.elements.name.value.trim(),
      companyName: profileForm.elements.companyName.value.trim(),
      contactEmail: profileForm.elements.contactEmail.value.trim(),
      country: profileForm.elements.country.value.trim(),
      website: profileForm.elements.website.value.trim(),
      logoUrl: profileForm.elements.logoUrl.value.trim(),
      about: profileForm.elements.about.value.trim(),
    };
    if (body.name.length < 2 || body.companyName.length < 2) {
      return showFormErrors(profileForm, { name: body.name.length < 2 ? 'Enter your name.' : '', companyName: body.companyName.length < 2 ? 'Enter your company name.' : '' }, 'Please fix the highlighted fields.');
    }
    const submit = profileForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Saving…');
    try {
      await api('/api/brand/profile', { method: 'PUT', body });
      toast('Brand profile saved.', 'success');
      loadProfile();
    } catch (err) {
      showFormErrors(profileForm, err.fields || {}, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });
}

const passwordForm = document.getElementById('brandPasswordForm');
if (passwordForm) {
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(passwordForm);
    const body = {
      currentPassword: passwordForm.elements.currentPassword.value,
      newPassword: passwordForm.elements.newPassword.value,
    };
    const fields = {};
    if (!body.currentPassword) fields.currentPassword = 'Enter your current password.';
    if (body.newPassword.length < 8) fields.newPassword = 'Use at least 8 characters.';
    if (passwordForm.elements.confirmPassword.value !== body.newPassword) fields.confirmPassword = 'Passwords do not match.';
    if (Object.keys(fields).length) return showFormErrors(passwordForm, fields, 'Please fix the highlighted fields.');
    const submit = passwordForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Updating…');
    try {
      await api('/api/auth/change-password', { method: 'POST', body });
      toast('Password updated.', 'success');
      passwordForm.reset();
    } catch (err) {
      showFormErrors(passwordForm, err.fields || {}, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });
}

(async function boot() {
  const me = await getMe();
  if (!requireUserRedirect(me, 'brand')) return;
  state.user = me;
  const avatar = document.querySelector('[data-user-avatar]');
  const brandName = me.brandProfile?.companyName || me.name;
  if (avatar) avatar.innerHTML = me.brandProfile?.logoUrl ? `<img src="${escapeHtml(me.brandProfile.logoUrl)}" alt="">` : escapeHtml(initials(brandName));
  document.querySelector('[data-user-name]').textContent = brandName;
  await loadOverview();
  setView(currentView(), false);
})();
