import { api, init, programCard, escapeHtml, formatNumber, $, $$, toast } from './app.js';

init();

const resultsEl = $('#results');
const countEl = $('#resultsCount');
const paginationEl = $('#pagination');
const activeFiltersEl = $('#activeFilters');
const searchInput = $('#directorySearch');
const sortSelect = $('#sortSelect');
const filtersPanel = $('#filters');

const DEFAULTS = { q: '', category: '', commissionType: '', minCommission: '', cookie: '', network: '', payment: '', sort: 'newest', page: 1, view: 'grid' };
const state = { ...DEFAULTS };
const labelMaps = { categories: {}, networks: [], payments: [] };

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  state.q = params.get('q') || '';
  state.category = params.get('category') || '';
  state.commissionType = params.get('commissionType') || '';
  state.minCommission = params.get('minCommission') || '';
  state.cookie = params.get('cookie') || '';
  state.network = params.get('network') || '';
  state.payment = params.get('payment') || '';
  state.sort = params.get('sort') || 'newest';
  state.page = Math.max(Number(params.get('page')) || 1, 1);
  state.view = localStorage.getItem('affilink:view') === 'list' ? 'list' : 'grid';
}

function writeUrl() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (!value) return;
    if (key === 'sort' && value === 'newest') return;
    if (key === 'page' && Number(value) === 1) return;
    if (key === 'view') return;
    params.set(key, value);
  });
  const qs = params.toString();
  window.history.replaceState({}, '', `/programs${qs ? `?${qs}` : ''}`);
}

function syncControls() {
  const catRadio = document.querySelector(`input[name="category"][value="${CSS.escape(state.category)}"]`);
  if (catRadio) catRadio.checked = true;
  else {
    const all = document.querySelector('input[name="category"][value=""]');
    if (all) all.checked = true;
  }
  $$('input[name="commissionType"]').forEach((el) => {
    el.checked = el.value === state.commissionType;
  });
  $('#minCommission').value = state.minCommission;
  $('#cookieFilter').value = state.cookie;
  $('#networkFilter').value = state.network;
  $('#paymentFilter').value = state.payment;
  sortSelect.value = state.sort;
  if (searchInput.value !== state.q) searchInput.value = state.q;
  $$('[data-view]').forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

async function loadFacets() {
  try {
    const data = await api('/api/programs?perPage=1');
    const facets = data.facets;
    const catWrap = $('#categoryFilters');
    catWrap.innerHTML =
      `<label class="filter-option"><input type="radio" name="category" value="" checked> All categories</label>` +
      facets.categories
        .map(
          (c) =>
            `<label class="filter-option"><input type="radio" name="category" value="${escapeHtml(c.slug)}"> ${escapeHtml(c.name)} <span class="count">${c.count}</span></label>`
        )
        .join('');
    const networkSelect = $('#networkFilter');
    networkSelect.innerHTML =
      '<option value="">All networks</option>' +
      facets.networks.map((n) => `<option value="${escapeHtml(n.value)}">${escapeHtml(n.value)} (${n.count})</option>`).join('');
    const paymentSelect = $('#paymentFilter');
    paymentSelect.innerHTML =
      '<option value="">Any method</option>' +
      facets.paymentMethods.map((p) => `<option value="${escapeHtml(p.value)}">${escapeHtml(p.value)} (${p.count})</option>`).join('');
    syncControls();
  } catch (err) {
    console.error(err);
  }
}

function chips() {
  const items = [];
  if (state.q) items.push({ key: 'q', label: `“${state.q}”` });
  if (state.category) {
    const radio = document.querySelector(`input[name="category"][value="${CSS.escape(state.category)}"]`);
    const text = radio?.parentElement?.textContent.trim().replace(/\s+\d+$/, '') || state.category;
    items.push({ key: 'category', label: text });
  }
  if (state.commissionType) {
    const map = { percentage: 'Revenue share', recurring: 'Recurring', fixed: 'Fixed CPA', tiered: 'Tiered' };
    items.push({ key: 'commissionType', label: map[state.commissionType] || state.commissionType });
  }
  if (state.minCommission) items.push({ key: 'minCommission', label: `Min ${state.minCommission}+` });
  if (state.cookie) items.push({ key: 'cookie', label: `${state.cookie}+ day cookie` });
  if (state.network) items.push({ key: 'network', label: state.network });
  if (state.payment) items.push({ key: 'payment', label: state.payment });
  activeFiltersEl.innerHTML = items
    .map(
      (item) =>
        `<span class="chip">${escapeHtml(item.label)} <button type="button" data-remove="${item.key}" aria-label="Remove filter ${escapeHtml(item.label)}"><i class="bi bi-x"></i></button></span>`
    )
    .join('');
  if (items.length > 1) {
    activeFiltersEl.insertAdjacentHTML('beforeend', '<button class="chip" type="button" data-clear-filters style="cursor:pointer">Clear all</button>');
  }
}

function listCard(p) {
  return `<article class="program-list-card">
    <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.brandName)} logo" width="52" height="52" loading="lazy">
    <div style="min-width:0">
      <div class="program-brand">${escapeHtml(p.brandName)}<i class="bi bi-patch-check-fill verify"></i></div>
      <a href="/programs/${escapeHtml(p.slug)}" class="fw-600" style="color:var(--ink);font-size:.92rem">${escapeHtml(p.title)}</a>
      <p class="program-desc" style="margin:4px 0 0;-webkit-line-clamp:1">${escapeHtml(p.description)}</p>
      <div class="program-cat" style="margin-top:6px">
        <i class="bi ${escapeHtml(p.category?.icon || 'bi-grid')}"></i>${escapeHtml(p.category?.name || '')}
        <span aria-hidden="true">·</span> ${escapeHtml(p.network)}
        <span aria-hidden="true">·</span> ${p.cookieDays} day cookie
        <span aria-hidden="true">·</span> ${(p.paymentMethods || []).slice(0, 2).join(', ')}
      </div>
    </div>
    <div class="list-card-right">
      <span class="badge badge-success" style="font-size:.78rem;padding:6px 10px">${escapeHtml(p.commissionLabel)}</span>
      <div class="flex items-center gap-2">
        <button class="save-btn ${p.saved ? 'is-saved' : ''}" type="button" data-save="${p.id}" aria-pressed="${Boolean(p.saved)}" aria-label="Save program">
          <i class="bi ${p.saved ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i>
        </button>
        <a class="btn btn-ghost btn-sm" href="/programs/${escapeHtml(p.slug)}">Details</a>
        <button class="btn btn-primary btn-sm" type="button" data-apply="${p.id}" data-slug="${escapeHtml(p.slug)}" data-url="${escapeHtml(p.signupUrl)}">Apply</button>
      </div>
    </div>
  </article>`;
}

function renderPagination(data) {
  if (data.totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }
  const pages = [];
  const total = data.totalPages;
  const current = data.page;
  const push = (n) => pages.push(n);
  if (total <= 7) {
    for (let i = 1; i <= total; i++) push(i);
  } else {
    push(1);
    if (current > 3) pages.push('…');
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) push(i);
    if (current < total - 2) pages.push('…');
    push(total);
  }
  paginationEl.innerHTML = `
    <button type="button" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
    ${pages
      .map((p) =>
        p === '…'
          ? '<span class="ellipsis">…</span>'
          : `<button type="button" data-page="${p}" class="${p === current ? 'is-active' : ''}" aria-label="Page ${p}" ${p === current ? 'aria-current="page"' : ''}>${p}</button>`
      )
      .join('')}
    <button type="button" data-page="${current + 1}" ${current === total ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;
}

async function loadPrograms() {
  resultsEl.setAttribute('aria-busy', 'true');
  countEl.textContent = 'Loading programs…';
  resultsEl.innerHTML = `<div class="loading-grid">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
  try {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.commissionType) params.set('commissionType', state.commissionType);
    if (state.minCommission) params.set('minCommission', state.minCommission);
    if (state.cookie) params.set('cookie', state.cookie);
    if (state.network) params.set('network', state.network);
    if (state.payment) params.set('payment', state.payment);
    params.set('sort', state.sort);
    params.set('page', String(state.page));
    params.set('perPage', '9');
    const data = await api(`/api/programs?${params.toString()}`);

    if (!data.items.length) {
      countEl.textContent = 'No programs match these filters';
      resultsEl.innerHTML = `<div class="empty-state">
        <div class="icon"><i class="bi bi-search"></i></div>
        <h3>No matching programs</h3>
        <p>Try removing a filter or searching for a broader keyword.</p>
        <button class="btn btn-primary btn-sm" type="button" data-clear-filters>Clear all filters</button>
      </div>`;
      paginationEl.innerHTML = '';
    } else {
      const from = (data.page - 1) * data.perPage + 1;
      const to = Math.min(data.page * data.perPage, data.total);
      countEl.innerHTML = `Showing <strong>${formatNumber(from)}–${formatNumber(to)}</strong> of <strong>${formatNumber(data.total)}</strong> programs${state.q ? ` for “${escapeHtml(state.q)}”` : ''}`;
      resultsEl.innerHTML =
        state.view === 'list'
          ? `<div style="display:grid;gap:12px">${data.items.map(listCard).join('')}</div>`
          : `<div class="program-grid">${data.items.map((p) => programCard(p)).join('')}</div>`;
      renderPagination(data);
    }
    chips();
    writeUrl();
    resultsEl.setAttribute('aria-busy', 'false');
  } catch (err) {
    countEl.textContent = 'Could not load programs';
    resultsEl.innerHTML = `<div class="empty-state"><div class="icon"><i class="bi bi-cloud-slash"></i></div><h3>Something went wrong</h3><p>${escapeHtml(err.message)}</p><button class="btn btn-primary btn-sm" type="button" data-retry>Try again</button></div>`;
    resultsEl.setAttribute('aria-busy', 'false');
    toast('Could not load programs.', 'error');
  }
}

function updateState(patch, { resetPage = true } = {}) {
  Object.assign(state, patch);
  if (resetPage) state.page = 1;
  loadPrograms();
}

/* Events */
filtersPanel.addEventListener('change', (event) => {
  const target = event.target;
  if (target.name === 'category') updateState({ category: target.value });
  else if (target.name === 'commissionType') updateState({ commissionType: target.value });
  else if (target.id === 'minCommission') updateState({ minCommission: target.value });
  else if (target.id === 'cookieFilter') updateState({ cookie: target.value });
  else if (target.id === 'networkFilter') updateState({ network: target.value });
  else if (target.id === 'paymentFilter') updateState({ payment: target.value });
});

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => updateState({ q: searchInput.value.trim() }), 350);
});

sortSelect.addEventListener('change', () => updateState({ sort: sortSelect.value }));

document.addEventListener('click', (event) => {
  const pageBtn = event.target.closest('[data-page]');
  if (pageBtn && !pageBtn.disabled) {
    state.page = Number(pageBtn.dataset.page);
    loadPrograms();
    document.querySelector('.directory-layout').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const removeBtn = event.target.closest('[data-remove]');
  if (removeBtn) {
    const key = removeBtn.dataset.remove;
    const names = { q: 'q', category: 'category', commissionType: 'commissionType', minCommission: 'minCommission', cookie: 'cookie', network: 'network', payment: 'payment' };
    if (key === 'q') searchInput.value = '';
    updateState({ [names[key]]: key === 'category' || key === 'commissionType' ? '' : '' });
    syncControls();
    return;
  }
  const clearBtn = event.target.closest('[data-clear-filters]');
  if (clearBtn) {
    Object.assign(state, DEFAULTS, { view: state.view });
    searchInput.value = '';
    $$('input[name="category"]')[0].checked = true;
    $$('input[name="commissionType"]')[0].checked = true;
    syncControls();
    loadPrograms();
    return;
  }
  const retry = event.target.closest('[data-retry]');
  if (retry) {
    loadPrograms();
    return;
  }
  const viewBtn = event.target.closest('[data-view]');
  if (viewBtn) {
    state.view = viewBtn.dataset.view;
    localStorage.setItem('affilink:view', state.view);
    syncControls();
    loadPrograms();
    return;
  }
  if (event.target.closest('[data-open-filters]')) {
    filtersPanel.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    return;
  }
  if (event.target.closest('[data-close-filters]') || event.target.closest('[data-apply-filters]')) {
    filtersPanel.classList.remove('is-open');
    document.body.style.overflow = '';
  }
});

readUrl();
syncControls();
loadFacets();
loadPrograms();
