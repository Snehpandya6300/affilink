import {
  api, init, programCard, escapeHtml, initials, formatDate, getMe, requireUserRedirect,
  toast, busy, showFormErrors, clearFormErrors, emptyState, $, $$,
} from './app.js';

init();

const TITLES = {
  overview: ['Overview', "Welcome back — here's what's happening with your programs."],
  saved: ['Saved programs', 'Your shortlist of programs you bookmarked to revisit.'],
  applications: ['My applications', 'Track each application and update its status as brands respond.'],
  links: ['My affiliate links', 'Your own Amazon, Etsy or brand affiliate links, with click tracking.'],
  profile: ['Profile settings', 'Help us recommend the right programs for your audience.'],
  settings: ['Account settings', 'Password, session and data controls.'],
};

const state = { user: null, overview: null, saved: [], applications: [] };

function currentView() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('saved')) return 'saved';
  if (params.has('applications')) return 'applications';
  if (params.has('links')) return 'links';
  if (params.has('profile')) return 'profile';
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
  $('[data-page-sub]').textContent = view === 'overview' && state.user ? `Welcome back, ${state.user.name.split(' ')[0]} — here's what's happening.` : sub;
  if (updateUrl) {
    const url = view === 'overview' ? '/dashboard' : `/dashboard?${view}`;
    window.history.replaceState({}, '', url);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'saved') loadSaved();
  if (view === 'applications') loadApplications();
  if (view === 'links') loadOffers();
  if (view === 'profile') loadProfile();
  if (view === 'settings') loadSettings();
}

function listItem(p, extra = '') {
  return `<a class="dash-list-item" href="/programs/${escapeHtml(p.slug)}">
    <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="" width="38" height="38" loading="lazy">
    <div class="info">
      <div class="t">${escapeHtml(p.brandName)}</div>
      <div class="s">${escapeHtml(p.commissionLabel)}${extra ? ` · ${escapeHtml(extra)}` : ''}</div>
    </div>
    <i class="bi bi-arrow-right arrow"></i>
  </a>`;
}

function renderOverview(data) {
  state.overview = data;
  $$('[data-stat]').forEach((el) => {
    el.textContent = data.stats[el.dataset.stat] ?? 0;
  });
  $('[data-count-saved]').textContent = data.stats.saved;
  $('[data-count-apps]').textContent = data.stats.totalApplications;

  $('[data-recent-programs]').innerHTML = data.recent.map((p) => listItem(p, p.category?.name)).join('') || '<p class="text-sm text-muted mb-0">No programs yet.</p>';
  $('[data-recommended]').innerHTML = data.recommended.map((p) => programCard(p)).join('') || '<p class="text-sm text-muted">Nothing to recommend yet.</p>';
  $('[data-saved-preview]').innerHTML = data.saved.length
    ? data.saved.map((p) => listItem(p)).join('')
    : '<p class="text-sm text-muted mb-0">No saved programs yet. Tap the bookmark icon on any listing.</p>';
  $('[data-viewed]').innerHTML = data.viewed.length
    ? data.viewed.map((p) => listItem(p, `viewed ${formatDate(p.viewedAt)}`)).join('')
    : '<p class="text-sm text-muted mb-0">Programs you view will appear here.</p>';

  const statuses = data.applications.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  const total = data.applications.length || 1;
  $('[data-app-preview]').innerHTML = data.applications.length
    ? Object.entries(statuses)
        .map(
          ([status, count]) => `<div style="margin-bottom:10px">
            <div class="flex items-center justify-between text-xs" style="margin-bottom:4px">
              <span class="status-dot status-${status}">${status}</span><span class="text-muted">${count}</span>
            </div>
            <div class="progress"><span style="width:${Math.round((count / total) * 100)}%"></span></div>
          </div>`
        )
        .join('')
    : '<p class="text-sm text-muted mb-0">No applications tracked yet.</p>';
}

async function loadOverview() {
  try {
    const data = await api('/api/creator/overview');
    state.user = { ...(data.user || {}), ...(state.user || {}) };
    renderOverview(data);
  } catch (err) {
    if (err.status === 401) return requireUserRedirect(null, 'creator');
    toast(err.message, 'error');
  }
}

async function loadSaved() {
  const grid = document.getElementById('savedGrid');
  try {
    const data = await api('/api/creator/saved');
    state.saved = data.items;
    $('[data-saved-count]').textContent = data.items.length;
    grid.innerHTML = data.items.length
      ? `<div class="program-grid two-col">${data.items.map((p) => programCard(p, { saved: true })).join('')}</div>`
      : emptyState('No saved programs yet', 'Bookmark programs from the directory to build your shortlist.', '<a class="btn btn-primary btn-sm" href="/programs">Browse programs</a>');
  } catch (err) {
    grid.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function statusOptions(current) {
  return ['pending', 'approved', 'rejected', 'withdrawn']
    .map((s) => `<option value="${s}" ${s === current ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`)
    .join('');
}

async function loadApplications() {
  const wrap = document.getElementById('applicationsTable');
  try {
    const data = await api('/api/creator/applications');
    state.applications = data.items;
    $('[data-count-apps]').textContent = data.items.length;
    if (!data.items.length) {
      wrap.innerHTML = emptyState(
        'No applications tracked',
        'Apply through the brand\'s official page, then record the application here to keep it organised.',
        '<button class="btn btn-primary btn-sm" type="button" data-open-track-modal>Track your first application</button>'
      );
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Program</th><th>Status</th><th>Applied</th><th>Notes</th><th aria-label="Actions"></th></tr></thead>
      <tbody>${data.items
        .map(
          (a) => `<tr data-app-row="${a.id}">
            <td>
              <div class="cell-main">
                <img class="program-logo" src="${escapeHtml(a.program.logoUrl)}" alt="" width="34" height="34" style="width:34px;height:34px;border-radius:9px">
                <div>
                  <a class="t" href="/programs/${escapeHtml(a.program.slug)}" style="color:var(--ink)">${escapeHtml(a.program.brandName)}</a>
                  <div class="s">${escapeHtml(a.program.commissionLabel)} · ${escapeHtml(a.program.network)}</div>
                </div>
              </div>
            </td>
            <td><select class="control" style="padding:6px 28px 6px 10px;font-size:.8rem;min-width:120px" data-app-status="${a.id}">${statusOptions(a.status)}</select></td>
            <td><input class="control" type="date" style="padding:6px 10px;font-size:.8rem" data-app-date="${a.id}" value="${escapeHtml(String(a.appliedAt).slice(0, 10))}"></td>
            <td><input class="control" style="padding:6px 10px;font-size:.8rem;min-width:170px" data-app-notes="${a.id}" placeholder="Add a note…" value="${escapeHtml(a.notes || '')}" maxlength="500"></td>
            <td>
              <div class="row-actions">
                <button type="button" data-app-open="${escapeHtml(a.program.slug)}" data-url="${escapeHtml(a.program.signupUrl)}" title="Open application page"><i class="bi bi-box-arrow-up-right"></i></button>
                <button type="button" class="danger" data-app-delete="${a.id}" title="Delete record"><i class="bi bi-trash3"></i></button>
              </div>
            </td>
          </tr>`
        )
        .join('')}</tbody></table></div>
      <p class="text-xs text-muted mt-2 mb-0">${data.items.length} tracked application${data.items.length === 1 ? '' : 's'}. Statuses are your own notes, not official confirmations.</p>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function patchApplication(id, patch) {
  try {
    await api(`/api/creator/applications/${id}`, { method: 'PATCH', body: patch });
    toast('Application updated.', 'success');
    await loadApplications();
    loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadProfile() {
  try {
    const { profile } = await api('/api/creator/profile');
    window.__profile = profile;
    const form = document.getElementById('profileForm');
    form.elements.name.value = profile.name || '';
    form.elements.email.value = profile.email || '';
    form.elements.avatarUrl.value = profile.avatarUrl || '';
    form.elements.country.value = profile.country || '';
    form.elements.niche.value = profile.niche || '';
    form.elements.audienceSize.value = profile.audienceSize || '';
    ['website', 'twitter', 'linkedin', 'instagram', 'youtube'].forEach((key) => {
      form.elements[key].value = profile[key] || '';
    });
    form.elements.bio.value = profile.bio || '';
    $$('#promoMethods input').forEach((input) => {
      input.checked = (profile.promoMethods || []).includes(input.value);
    });
    $('[data-profile-name]').textContent = profile.name;
    $('[data-profile-email]').textContent = profile.email;
    const avatarEl = $('[data-profile-avatar]');
    avatarEl.innerHTML = profile.avatarUrl
      ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" onerror="this.remove()">`
      : escapeHtml(initials(profile.name));
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadSettings() {
  try {
    const { profile } = await api('/api/creator/profile');
    $('[data-settings-email]').textContent = profile.email;
    $('[data-settings-since]').textContent = formatDate(profile.memberSince);
  } catch {
    /* ignore */
  }
}

/* -------------------------------- events */
document.addEventListener('click', async (event) => {
  const viewBtn = event.target.closest('.side-link[data-view], [data-view]');
  if (viewBtn && viewBtn.dataset.view && viewBtn.closest('.dash-shell')) {
    event.preventDefault();
    setView(viewBtn.dataset.view);
    return;
  }
  if (event.target.closest('[data-open-track-modal]')) {
    openTrackModal();
    return;
  }
  const openBtn = event.target.closest('[data-app-open]');
  if (openBtn) {
    window.open(openBtn.dataset.url, '_blank', 'noopener,noreferrer');
    api(`/api/programs/${encodeURIComponent(openBtn.dataset.appOpen)}/click`, { method: 'POST' }).catch(() => {});
    return;
  }
  const delBtn = event.target.closest('[data-app-delete]');
  if (delBtn) {
    if (!window.confirm('Delete this application record? This does not withdraw an application submitted to the brand.')) return;
    try {
      await api(`/api/creator/applications/${delBtn.dataset.appDelete}`, { method: 'DELETE' });
      toast('Application record deleted.', 'success');
      loadApplications();
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  if (event.target.closest('[data-export]')) {
    event.preventDefault();
    try {
      const [profile, saved, apps] = await Promise.all([
        api('/api/creator/profile'),
        api('/api/creator/saved'),
        api('/api/creator/applications'),
      ]);
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, saved: saved.items, applications: apps.items }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'affilink-creator-data.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

document.addEventListener('change', (event) => {
  const statusSelect = event.target.closest('[data-app-status]');
  if (statusSelect) patchApplication(statusSelect.dataset.appStatus, { status: statusSelect.value });
  const dateInput = event.target.closest('[data-app-date]');
  if (dateInput) patchApplication(dateInput.dataset.appDate, { appliedAt: dateInput.value });
});

document.addEventListener('focusout', (event) => {
  const notesInput = event.target.closest('[data-app-notes]');
  if (notesInput) {
    const row = state.applications.find((a) => String(a.id) === notesInput.dataset.appNotes);
    if (row && (row.notes || '') !== notesInput.value) patchApplication(notesInput.dataset.appNotes, { notes: notesInput.value });
  }
});

document.addEventListener('program:saved', () => {
  loadSaved();
  loadOverview();
});

const profileForm = document.getElementById('profileForm');
if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(profileForm);
    const form = profileForm;
    const body = {
      name: form.elements.name.value.trim(),
      avatarUrl: form.elements.avatarUrl.value.trim(),
      country: form.elements.country.value.trim(),
      niche: form.elements.niche.value.trim(),
      audienceSize: form.elements.audienceSize.value.trim(),
      website: form.elements.website.value.trim(),
      twitter: form.elements.twitter.value.trim(),
      linkedin: form.elements.linkedin.value.trim(),
      instagram: form.elements.instagram.value.trim(),
      youtube: form.elements.youtube.value.trim(),
      bio: form.elements.bio.value.trim(),
      promoMethods: $$('#promoMethods input:checked').map((i) => i.value),
    };
    if (body.name.length < 2) return showFormErrors(form, { name: 'Enter your name.' }, 'Please fix the highlighted fields.');
    const submit = form.querySelector('button[type="submit"]');
    busy(submit, true, 'Saving…');
    try {
      await api('/api/creator/profile', { method: 'PUT', body });
      toast('Profile saved.', 'success');
      loadProfile();
      loadOverview();
    } catch (err) {
      showFormErrors(form, err.fields || {}, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });
}

const passwordForm = document.getElementById('passwordForm');
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

async function openTrackModal() {
  const modalEl = document.getElementById('trackModal');
  const select = document.getElementById('trackProgram');
  const dateInput = document.getElementById('trackDate');
  const notes = document.getElementById('trackNotes');
  const submit = document.getElementById('trackSubmit');
  const alert = modalEl.querySelector('[data-form-alert]');
  alert.hidden = true;
  notes.value = '';
  dateInput.value = new Date().toISOString().slice(0, 10);
  select.innerHTML = '<option value="">Loading programs…</option>';
  const modal = window.bootstrap ? new window.bootstrap.Modal(modalEl) : null;
  if (modal) modal.show();
  else modalEl.classList.add('show');
  try {
    const data = await api('/api/programs?perPage=48&sort=alpha');
    const tracked = new Set(state.applications.map((a) => a.program.id));
    select.innerHTML = data.items
      .filter((p) => !tracked.has(p.id))
      .map((p) => `<option value="${p.id}">${escapeHtml(p.brandName)} — ${escapeHtml(p.commissionLabel)}</option>`)
      .join('') || '<option value="">All programs are already tracked</option>';
  } catch {
    select.innerHTML = '<option value="">Could not load programs</option>';
  }
  submit.onclick = async () => {
    if (!select.value) return toast('Choose a program to track.', 'warning');
    busy(submit, true, 'Saving…');
    try {
      await api('/api/creator/applications', {
        method: 'POST',
        body: { programId: Number(select.value), notes: notes.value.trim() },
      });
      const appId = null;
      const updated = await api('/api/creator/applications');
      const target = updated.items[0];
      if (target && dateInput.value) {
        await api(`/api/creator/applications/${target.id}`, { method: 'PATCH', body: { appliedAt: dateInput.value } });
      }
      void appId;
      toast('Application tracked.', 'success');
      if (modal) modal.hide();
      setView('applications');
    } catch (err) {
      alert.textContent = err.message;
      alert.hidden = false;
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  };
}

/* ---------------------------------- boot */

/* ---------------------------------------------------------------------------
   Creator-owned affiliate links
--------------------------------------------------------------------------- */

const offerState = { items: [], stats: { total: 0, clicks: 0 }, editingId: null };
const offerForm = $('#offerForm');

function offerRow(o) {
  const share = `${window.location.origin}${o.shareUrl}`;
  return `<article class="offer-item" data-offer-id="${o.id}">
    <div class="offer-main">
      <div class="offer-head">
        <span class="offer-title">${escapeHtml(o.title)}</span>
        ${o.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-outline">Paused</span>'}
      </div>
      <div class="offer-meta">${escapeHtml(o.brandName)}${o.commissionNote ? ` · ${escapeHtml(o.commissionNote)}` : ''} · <strong>${o.clicks}</strong> click${o.clicks === 1 ? '' : 's'}</div>
      ${o.description ? `<p class="offer-desc">${escapeHtml(o.description)}</p>` : ''}
      <code class="offer-link">${escapeHtml(share)}</code>
      <div class="offer-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-action="copy" data-link="${escapeHtml(share)}"><i class="bi bi-clipboard"></i> Copy link</button>
        <a class="btn btn-ghost btn-sm" href="${escapeHtml(o.destinationUrl)}" target="_blank" rel="noopener noreferrer nofollow sponsored"><i class="bi bi-box-arrow-up-right"></i> Open</a>
        <button class="btn btn-ghost btn-sm" type="button" data-action="edit">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="toggle">${o.isActive ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="delete" aria-label="Delete ${escapeHtml(o.title)}"><i class="bi bi-trash3"></i></button>
      </div>
    </div>
  </article>`;
}

function renderOffers() {
  const { items, stats } = offerState;
  const total = stats.total ?? items.length;
  const clicks = stats.clicks || 0;
  $('[data-count-offers]').textContent = total;
  $('[data-offer-summary]').textContent = `${total} link${total === 1 ? '' : 's'} · ${clicks} click${clicks === 1 ? '' : 's'}`;
  const list = $('[data-offer-list]');
  list.innerHTML = items.length
    ? items.map(offerRow).join('')
    : emptyState('No affiliate links yet', 'Add your Amazon, Etsy or any brand link and share the short Affilink URL. Clicks are counted for you.');
}

async function loadOffers() {
  try {
    const data = await api('/api/creator/offers');
    offerState.items = data.items;
    offerState.stats = data.stats;
    renderOffers();
  } catch (err) {
    if (err.status === 401) return requireUserRedirect(null, 'creator');
    toast(err.message, 'error');
  }
}

function resetOfferForm() {
  offerState.editingId = null;
  offerForm.reset();
  clearFormErrors(offerForm);
  $('[data-offer-form-title]').textContent = 'Create a link';
  $('[data-offer-cancel]').hidden = true;
  $('[data-offer-submit]', offerForm).innerHTML = '<i class="bi bi-link-45deg"></i> Create link';
  const hint = $('[data-offer-hint]');
  hint.textContent = "Use the exact link from the brand's affiliate dashboard so your tracking is preserved.";
}

function startOfferEdit(id) {
  const offer = offerState.items.find((o) => o.id === id);
  if (!offer) return;
  offerState.editingId = id;
  offerForm.elements.brandName.value = offer.brandName;
  offerForm.elements.title.value = offer.title;
  offerForm.elements.destinationUrl.value = offer.destinationUrl;
  offerForm.elements.category.value = offer.category || '';
  offerForm.elements.commissionNote.value = offer.commissionNote || '';
  offerForm.elements.description.value = offer.description || '';
  $('[data-offer-form-title]').textContent = 'Edit link';
  $('[data-offer-cancel]').hidden = false;
  $('[data-offer-submit]', offerForm).innerHTML = '<i class="bi bi-check2"></i> Save changes';
  offerForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (offerForm) {
  offerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(offerForm);
    const body = Object.fromEntries(new FormData(offerForm).entries());
    const submit = $('[data-offer-submit]', offerForm);
    const editing = offerState.editingId;
    busy(submit, true, editing ? 'Saving…' : 'Creating…');
    try {
      const result = await api(editing ? `/api/creator/offers/${editing}` : '/api/creator/offers', {
        method: editing ? 'PUT' : 'POST',
        body,
      });
      toast(result.message);
      resetOfferForm();
      await loadOffers();
    } catch (err) {
      showFormErrors(offerForm, err.fields, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });

  $('[data-offer-cancel]').addEventListener('click', resetOfferForm);

  $$('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      offerForm.elements.brandName.value = button.dataset.preset || '';
      offerForm.elements.category.value = button.dataset.cat || '';
      $('[data-offer-hint]').textContent = button.dataset.hint;
      offerForm.elements.destinationUrl.focus();
    });
  });

  $('[data-offer-list]').addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const item = action.closest('[data-offer-id]');
    const id = Number(item?.dataset.offerId);
    const offer = offerState.items.find((o) => o.id === id);
    if (!offer) return;

    if (action.dataset.action === 'copy') {
      try {
        await navigator.clipboard.writeText(action.dataset.link);
        toast('Share link copied to your clipboard.');
      } catch {
        toast(`Copy this link: ${action.dataset.link}`, 'info', 9000);
      }
      return;
    }
    if (action.dataset.action === 'edit') return startOfferEdit(id);
    if (action.dataset.action === 'toggle') {
      try {
        await api(`/api/creator/offers/${id}`, { method: 'PUT', body: { isActive: !offer.isActive } });
        toast(offer.isActive ? 'Link paused — the short URL stops redirecting.' : 'Link resumed.');
        await loadOffers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (action.dataset.action === 'delete') {
      if (!window.confirm(`Delete “${offer.title}”? The short link will stop working.`)) return;
      try {
        await api(`/api/creator/offers/${id}`, { method: 'DELETE' });
        if (offerState.editingId === id) resetOfferForm();
        toast('Link deleted.');
        await loadOffers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

(async function boot() {
  const me = await getMe();
  if (!requireUserRedirect(me, 'creator')) return;
  state.user = me;
  const avatar = document.querySelector('[data-user-avatar]');
  if (avatar) avatar.innerHTML = me.avatarUrl ? `<img src="${escapeHtml(me.avatarUrl)}" alt="">` : escapeHtml(initials(me.name));
  document.querySelector('[data-user-name]').textContent = me.name;
  await loadOverview();
  await loadApplications();
  await loadOffers();
  setView(currentView(), false);
})();
