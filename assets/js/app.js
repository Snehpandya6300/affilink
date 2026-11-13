/* Affilink shared client library */

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload || {};
    this.fields = payload?.fields || null;
  }
}

export async function api(path, options = {}) {
  const config = { credentials: 'same-origin', headers: {}, ...options };
  if (config.body && typeof config.body !== 'string') {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(path, config);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'Unexpected server response.' };
    }
  }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Please try again.', res.status, data);
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function formatNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < 3600000) return 'Just now';
  if (diff < day) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return formatDate(value);
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

/* ------------------------------------------------------------------ toasts */
export function toast(message, type = 'success', timeout = 4200) {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'error' ? 'bi-exclamation-octagon' : type === 'warning' ? 'bi-exclamation-triangle' : 'bi-check-circle';
  el.innerHTML = `<i class="bi ${icon}"></i><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 240);
  }, timeout);
}

/* ------------------------------------------------------------------ buttons */
export function busy(button, on, label = 'Working…') {
  if (!button) return;
  if (on) {
    button.dataset.original = button.innerHTML;
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm" style="width:.9rem;height:.9rem;border-width:.14em" aria-hidden="true"></span>${label}`;
  } else {
    button.removeAttribute('aria-busy');
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

/* ------------------------------------------------------------------- forms */
export function clearFormErrors(form) {
  $$('.field.has-error', form).forEach((f) => f.classList.remove('has-error'));
  $$('.error', form).forEach((e) => {
    e.textContent = '';
  });
  const alert = $('[data-form-alert]', form);
  if (alert) alert.hidden = true;
}

export function showFormErrors(form, fields = {}, fallback = '') {
  clearFormErrors(form);
  Object.entries(fields || {}).forEach(([key, message]) => {
    const input = form.elements[key];
    const field = input?.closest('.field');
    if (field) {
      field.classList.add('has-error');
      const err = $('.error', field);
      if (err) err.textContent = message;
    }
  });
  const alert = $('[data-form-alert]', form);
  if (alert && fallback) {
    alert.textContent = fallback;
    alert.hidden = false;
  }
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((value, key) => {
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2);
      out[k] = out[k] || [];
      out[k].push(value);
    } else if (key in out) {
      out[key] = [].concat(out[key], value);
    } else {
      out[key] = value;
    }
  });
  return out;
}

export function setLoading(container, count = 3) {
  if (!container) return;
  container.innerHTML = `<div class="loading-grid">${Array.from({ length: count }).map(() => '<div class="skeleton"></div>').join('')}</div>`;
}

export function emptyState(title, message, action = '') {
  return `<div class="empty-state">
    <div class="icon"><i class="bi bi-search"></i></div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    ${action}
  </div>`;
}

/* -------------------------------------------------------------- program UI */
export function programCard(p, { saved = false } = {}) {
  const payment = (p.paymentMethods || [])[0] || 'Not published';
  const cookie = Number(p.cookieDays) > 0 ? `${p.cookieDays} day${Number(p.cookieDays) === 1 ? '' : 's'}` : 'Not published';
  const isSaved = saved || p.saved;
  return `<article class="program-card" data-program-card data-program-slug="${escapeHtml(p.slug)}">
    <div class="program-card-head">
      <img class="program-logo" src="${escapeHtml(p.logoUrl || '/logos/affilink.svg')}" alt="${escapeHtml(p.brandName)} logo" width="46" height="46" loading="lazy">
      <div class="program-card-title">
        <a class="program-brand" href="/programs/${escapeHtml(p.slug)}">${escapeHtml(p.brandName)}${p.isDemo ? '' : '<i class="bi bi-patch-check-fill verify" title="Terms checked against the brand page"></i>'}</a>
        <span class="program-cat"><i class="bi ${escapeHtml(p.category?.icon || 'bi-grid')}"></i>${escapeHtml(p.category?.name || 'General')}${p.featured ? ' · <span class="text-accent fw-600">Featured</span>' : ''}</span>
      </div>
      <button class="save-btn ${isSaved ? 'is-saved' : ''}" type="button" data-save="${p.id}"
        aria-pressed="${Boolean(isSaved)}" aria-label="${isSaved ? 'Remove from saved programs' : 'Save program'}" title="${isSaved ? 'Saved' : 'Save program'}">
        <i class="bi ${isSaved ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i>
      </button>
    </div>
    <a href="/programs/${escapeHtml(p.slug)}"><h3 class="program-title">${escapeHtml(p.title)}</h3></a>
    <p class="program-desc">${escapeHtml(p.description)}</p>
    <p class="program-updated"><i class="bi bi-clock-history"></i> Updated ${escapeHtml(timeAgo(p.updatedAt))}</p>
    <div class="program-meta">
      <div class="meta-item"><div class="meta-label">Commission</div><div class="meta-value accent" title="${escapeHtml(p.commissionLabel)}">${escapeHtml(p.commissionLabel)}</div></div>
      <div class="meta-item"><div class="meta-label">Cookie</div><div class="meta-value">${cookie}</div></div>
      <div class="meta-item"><div class="meta-label">Network</div><div class="meta-value">${escapeHtml(p.network)}</div></div>
      <div class="meta-item"><div class="meta-label">Payment</div><div class="meta-value">${escapeHtml(payment)}</div></div>
    </div>
    <div class="program-card-foot">
      <a class="btn btn-ghost btn-sm" href="/programs/${escapeHtml(p.slug)}">Details</a>
      <button class="btn btn-primary btn-sm" type="button" data-apply="${p.id}" data-slug="${escapeHtml(p.slug)}" data-url="${escapeHtml(p.signupUrl || '')}">Apply Now <i class="bi bi-arrow-up-right"></i></button>
    </div>
  </article>`;
}

export function programRow(p) {
  return `<div class="program-list-item" data-program-slug="${escapeHtml(p.slug)}">
    <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.brandName)} logo" width="52" height="52" loading="lazy">
    <div style="min-width:0">
      <div class="program-brand">${escapeHtml(p.brandName)}<i class="bi bi-patch-check-fill verify"></i></div>
      <a href="/programs/${escapeHtml(p.slug)}" class="text-sm fw-600" style="color:var(--ink)">${escapeHtml(p.title)}</a>
      <div class="program-cat" style="margin-top:2px">${escapeHtml(p.category?.name || '')} · ${escapeHtml(p.network)} · ${Number(p.cookieDays) > 0 ? `${p.cookieDays} day cookie` : 'cookie not published'}</div>
    </div>
    <div class="flex items-center gap-2">
      <span class="badge badge-success">${escapeHtml(p.commissionLabel)}</span>
      <a class="btn btn-ghost btn-sm" href="/programs/${escapeHtml(p.slug)}">View</a>
    </div>
  </div>`;
}

/* ----------------------------------------------------------- interactions */
export async function toggleSaved(programId, button) {
  const isSaved = button.getAttribute('aria-pressed') === 'true';
  button.disabled = true;
  try {
    if (isSaved) {
      await api(`/api/creator/saved/${programId}`, { method: 'DELETE' });
    } else {
      await api(`/api/creator/saved/${programId}`, { method: 'POST' });
    }
    button.setAttribute('aria-pressed', String(!isSaved));
    button.classList.toggle('is-saved', !isSaved);
    button.innerHTML = `<i class="bi ${!isSaved ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i>`;
    button.setAttribute('title', !isSaved ? 'Saved' : 'Save program');
    toast(!isSaved ? 'Saved to your programs.' : 'Removed from saved programs.', 'success');
    document.dispatchEvent(new CustomEvent('program:saved', { detail: { programId: Number(programId), saved: !isSaved } }));
  } catch (err) {
    if (err.status === 401) {
      toast('Sign in to save programs.', 'warning');
      setTimeout(() => {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }, 700);
    } else {
      toast(err.message, 'error');
    }
  } finally {
    button.disabled = false;
  }
}

export function initInteractions(root = document) {
  root.addEventListener('click', (event) => {
    const saveBtn = event.target.closest('[data-save]');
    if (saveBtn) {
      event.preventDefault();
      toggleSaved(saveBtn.dataset.save, saveBtn);
      return;
    }
    const applyBtn = event.target.closest('[data-apply]');
    if (applyBtn) {
      event.preventDefault();
      const url = applyBtn.dataset.url;
      const slug = applyBtn.dataset.slug;
      if (!url) return toast('This program has no application link yet.', 'error');
      // Open synchronously so popup blockers allow it, then record analytics.
      window.open(url, '_blank', 'noopener,noreferrer');
      api(`/api/programs/${encodeURIComponent(slug)}/click`, { method: 'POST' }).catch(() => {});
      return;
    }
    const logout = event.target.closest('[data-logout]');
    if (logout) {
      event.preventDefault();
      api('/api/auth/logout', { method: 'POST' })
        .then(() => {
          window.location.href = '/';
        })
        .catch(() => {
          window.location.href = '/';
        });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.body.classList.remove('nav-open');
  });
}

/* ------------------------------------------------------------------ header */
export function initSiteChrome() {
  $$('[data-current-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
  const toggle = $('[data-nav-toggle]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
  const header = $('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  const path = window.location.pathname;
  $$('.main-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === path || (href !== '/' && path.startsWith(href))) link.setAttribute('aria-current', 'page');
  });
}

/* ------------------------------------------------------------- animations */
export function initAnimations() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !window.gsap) return;
  const { gsap } = window;
  const heroBits = $$('.hero [data-hero]');
  if (heroBits.length) {
    gsap.from(heroBits, { y: 22, opacity: 0, duration: 0.85, stagger: 0.09, ease: 'power3.out', delay: 0.05 });
  }
  if (window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    $$('[data-reveal]').forEach((el) => {
      gsap.from(el, {
        y: 24,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      });
    });
    $$('[data-reveal-group]').forEach((group) => {
      gsap.from(Array.from(group.children), {
        y: 26,
        opacity: 0,
        duration: 0.6,
        stagger: 0.07,
        ease: 'power2.out',
        scrollTrigger: { trigger: group, start: 'top 88%', once: true },
      });
    });
  }
}

let me = null;
export async function getMe() {
  if (me !== null) return me;
  try {
    const data = await api('/api/auth/me');
    me = data.user;
  } catch {
    me = null;
  }
  return me;
}

export function requireUserRedirect(user, role) {
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }
  if (role && user.role !== role) {
    window.location.href = user.role === 'brand' ? '/brand/dashboard' : user.role === 'admin' ? '/admin' : '/dashboard';
    return false;
  }
  return true;
}

export function init() {
  document.documentElement.classList.remove('no-js');
  initSiteChrome();
  initInteractions();
  const run = () => initAnimations();
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
