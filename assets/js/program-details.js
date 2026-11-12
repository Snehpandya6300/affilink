import { api, init, escapeHtml, formatDate, initials, toast, getMe, programCard, busy, showFormErrors, clearFormErrors } from './app.js';

init();

const slug = decodeURIComponent(window.location.pathname.replace(/^\/programs\//, '').replace(/\/$/, ''));
const root = document.getElementById('detailRoot');

function tagList(items) {
  if (!items || !items.length) return '<span class="text-sm text-muted">Not specified</span>';
  return `<div class="tag-list">${items.map((i) => `<span class="badge badge-outline">${escapeHtml(i)}</span>`).join('')}</div>`;
}

const publishedDays = (days) => (Number(days) > 0 ? `${days} day${Number(days) === 1 ? '' : 's'}` : 'Not published');

function tiersTable(tiers) {
  if (!tiers || !tiers.length) return '';
  return `<div class="table-wrap mt-3">
    <table class="data-table">
      <thead><tr><th>Tier</th><th>Commission</th></tr></thead>
      <tbody>${tiers.map((t) => `<tr><td>${escapeHtml(t.name)}</td><td class="fw-600">${escapeHtml(String(t.rate))}%</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  return `<span class="stars" aria-label="${r} out of 5 stars">${'<i class="bi bi-star-fill"></i>'.repeat(r)}${'<i class="bi bi-star"></i>'.repeat(5 - r)}</span>`;
}

function render(p, me) {
  document.title = `${p.brandName} Affiliate Program — ${p.commissionLabel} · Affilink`;
  const crumb = document.querySelector('[data-crumb]');
  if (crumb) crumb.textContent = p.brandName;

  const reviewBlock =
    p.reviews && p.reviews.length
      ? p.reviews
          .map(
            (r) => `<div class="review-item">
              <div class="review-head">
                <div class="review-author"><span class="avatar avatar-sm">${escapeHtml(initials(r.author))}</span>${escapeHtml(r.author)}</div>
                <div class="flex items-center gap-2">${stars(r.rating)}<span class="text-xs text-muted">${formatDate(r.created_at)}</span></div>
              </div>
              <p class="review-body">${escapeHtml(r.body)}</p>
            </div>`
          )
          .join('')
      : '<p class="text-sm text-muted">No approved reviews yet. Be the first to share your experience.</p>';

  const reviewForm = me
    ? `<form class="review-form" id="reviewForm" novalidate>
        <h3 class="text-sm fw-600">Share your experience</h3>
        <p class="text-xs text-muted">Reviews are moderated by the Affilink team before appearing publicly.</p>
        <div class="field">
          <label for="rating">Your rating</label>
          <select class="control" id="rating" name="rating" style="max-width:180px">
            <option value="5">5 — Excellent</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Average</option>
            <option value="2">2 — Below average</option>
            <option value="1">1 — Poor</option>
          </select>
        </div>
        <div class="field">
          <label for="reviewBody">Your review</label>
          <textarea id="reviewBody" name="body" placeholder="What was the approval process like? How did the program perform?" maxlength="1000"></textarea>
          <div class="error"></div>
        </div>
        <div class="alert alert-danger" data-form-alert hidden></div>
        <button class="btn btn-ghost btn-sm" type="submit">Submit review</button>
      </form>`
    : `<div class="review-form">
        <p class="text-sm text-muted mb-0">Sign in as a creator to leave a review. <a href="/login?next=${encodeURIComponent(window.location.pathname)}" style="color:var(--accent);font-weight:600">Sign in</a></p>
      </div>`;

  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `<div class="detail-layout">
    <div>
      <div class="detail-hero">
        <img class="program-logo" src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.brandName)} logo" width="76" height="76">
        <div style="min-width:0">
          <h1>${escapeHtml(p.brandName)} Affiliate Program</h1>
          <div class="detail-sub">
            <a href="/programs?category=${escapeHtml(p.category?.slug || '')}" class="badge badge-accent"><i class="bi ${escapeHtml(p.category?.icon || 'bi-grid')}"></i> ${escapeHtml(p.category?.name || 'General')}</a>
            <span>${escapeHtml(p.network)}</span>
            <span aria-hidden="true">·</span>
            <span>Updated ${formatDate(p.updatedAt)}</span>
            ${p.reviewCount ? `<span aria-hidden="true">·</span><span class="flex items-center gap-2">${stars(p.rating)} ${p.rating} (${p.reviewCount})</span>` : ''}
          </div>
        </div>
        <div class="detail-actions">
          <button class="save-btn ${p.saved ? 'is-saved' : ''}" style="width:42px;height:42px" type="button" data-save="${p.id}" aria-pressed="${Boolean(p.saved)}" aria-label="Save program">
            <i class="bi ${p.saved ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i>
          </button>
          <a class="btn btn-ghost" href="${escapeHtml(p.websiteUrl)}" target="_blank" rel="noopener noreferrer nofollow">Brand website <i class="bi bi-box-arrow-up-right"></i></a>
        </div>
      </div>

      <div class="disclaimer">
        <i class="bi bi-info-circle"></i>
        ${p.isDemo
          ? '<span><strong>Demo listing.</strong> This brand and its numbers are sample data for the brand dashboard, not a real partner. Applications are handled by the brand’s official affiliate program, not Affilink.</span>'
          : `<span><strong>Verified ${formatDate(p.verifiedAt)}.</strong> Commission, cookie and payout details were checked against ${p.sourceUrl ? `<a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">the brand's official program page</a>` : "the brand's official program page"}. Terms change without notice — confirm them before you start promoting. Applications are handled by the brand, not Affilink.</span>`}
      </div>

      <section class="detail-card">
        <h2>Program overview</h2>
        <p>${escapeHtml(p.description)}</p>
        <div class="spec-grid mt-4">
          <div><div class="spec-label">Commission type</div><div class="spec-value">${escapeHtml(p.commissionType === 'fixed' ? 'Fixed CPA' : p.commissionType === 'recurring' ? 'Recurring commission' : p.commissionType === 'tiered' ? 'Tiered structure' : 'Revenue share')}</div></div>
          <div><div class="spec-label">Commission</div><div class="spec-value fw-600" style="color:var(--success)">${escapeHtml(p.commissionLabel)}</div></div>
          <div><div class="spec-label">Cookie duration</div><div class="spec-value">${publishedDays(p.cookieDays)}</div></div>
          <div><div class="spec-label">Minimum payout</div><div class="spec-value">${p.minPayout ? `$${p.minPayout} ${escapeHtml(p.currency)}` : 'Not published'}</div></div>
          <div><div class="spec-label">Payment frequency</div><div class="spec-value">${escapeHtml(p.paymentFrequency)}</div></div>
          <div><div class="spec-label">Affiliate network</div><div class="spec-value">${escapeHtml(p.network)}</div></div>
          <div><div class="spec-label">Eligible countries</div><div class="spec-value">${escapeHtml(p.eligibleCountries)}</div></div>
          <div><div class="spec-label">Last updated</div><div class="spec-value">${formatDate(p.updatedAt)}</div></div>
        </div>
        ${tiersTable(p.commissionTiers)}
      </section>

      <section class="detail-card">
        <h2>Payment &amp; promotional details</h2>
        <div class="detail-two-col">
          <div>
            <h3>Payment methods</h3>
            ${tagList(p.paymentMethods)}
            <div class="text-xs text-muted mt-2">Paid ${escapeHtml(p.paymentFrequency.toLowerCase())} · ${p.minPayout ? `minimum payout $${p.minPayout}` : 'minimum payout not published'}</div>
          </div>
          <div>
            <h3>Accepted promotional methods</h3>
            ${tagList(p.promoMethods)}
          </div>
        </div>
        <div class="mt-4">
          <h3>Program requirements</h3>
          <p class="text-sm text-muted" style="white-space:pre-line">${escapeHtml(p.requirements)}</p>
        </div>
      </section>

      <section class="detail-card" id="reviews">
        <div class="panel-head" style="margin-bottom:6px">
          <h2 style="margin:0">Creator reviews</h2>
          ${p.reviewCount ? `<div class="flex items-center gap-2">${stars(p.rating)} <span class="text-sm text-muted">${p.rating} · ${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}</span></div>` : ''}
        </div>
        <div>${reviewBlock}</div>
        ${reviewForm}
      </section>

      ${p.similar && p.similar.length ? `<section class="detail-card">
        <h2>Similar affiliate programs</h2>
        <div class="similar-grid">${p.similar.map((s) => programCard(s)).join('')}</div>
      </section>` : ''}
    </div>

    <aside>
      <div class="detail-card apply-card">
        <div class="commission">${escapeHtml(p.commissionLabel)}</div>
        <div class="commission-label">Commission structure</div>
        <div class="divider"></div>
        <div class="mini-spec"><span class="k">Cookie</span><span class="v">${publishedDays(p.cookieDays)}</span></div>
        <div class="mini-spec"><span class="k">Minimum payout</span><span class="v">${p.minPayout ? `$${p.minPayout}` : 'Not published'}</span></div>
        <div class="mini-spec"><span class="k">Payment</span><span class="v">${escapeHtml(p.paymentFrequency)}</span></div>
        <div class="mini-spec"><span class="k">Network</span><span class="v">${escapeHtml(p.network)}</span></div>
        <div class="mini-spec"><span class="k">Countries</span><span class="v">${escapeHtml(p.eligibleCountries)}</span></div>
        <div class="divider"></div>
        <button class="btn btn-primary btn-block btn-lg" type="button" data-apply="${p.id}" data-slug="${escapeHtml(p.slug)}" data-url="${escapeHtml(p.signupUrl)}">Apply to This Program <i class="bi bi-arrow-up-right"></i></button>
        <button class="btn btn-ghost btn-block mt-2 ${p.saved ? 'is-saved' : ''}" type="button" data-track-application data-program-id="${p.id}" data-slug="${escapeHtml(p.slug)}">
          <i class="bi bi-check2-square"></i> ${p.application ? `Tracking: ${escapeHtml(p.application.status)}` : 'Track this application'}
        </button>
        <p class="apply-note">
          You will be taken to the brand's official affiliate signup page. Affilink does not review or approve applications.
          ${p.websiteUrl ? `<a href="${escapeHtml(p.websiteUrl)}" target="_blank" rel="noopener noreferrer nofollow">Visit ${escapeHtml(p.brandName)}</a>` : ''}
        </p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Listing activity</h2></div>
        <div class="mini-spec"><span class="k">Views</span><span class="v">${(p.viewCount || 0).toLocaleString()}</span></div>
        <div class="mini-spec"><span class="k">Outbound clicks</span><span class="v">${(p.clickCount || 0).toLocaleString()}</span></div>
        <div class="mini-spec"><span class="k">Saves</span><span class="v">${(p.saveCount || 0).toLocaleString()}</span></div>
        <p class="text-xs text-muted mt-2 mb-0">Activity recorded in this environment.</p>
      </div>
    </aside>
  </div>`;

  const form = document.getElementById('reviewForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const submit = form.querySelector('button[type="submit"]');
      const body = form.elements.body.value.trim();
      if (body.length < 15) {
        showFormErrors(form, { body: 'Please write at least 15 characters.' }, 'Please write a slightly longer review.');
        return;
      }
      busy(submit, true, 'Submitting…');
      try {
        const data = await api(`/api/programs/${encodeURIComponent(p.slug)}/reviews`, { method: 'POST', body: { rating: Number(form.elements.rating.value), body } });
        toast(data.message || 'Review submitted.', 'success');
        form.reset();
      } catch (err) {
        if (err.status === 401) {
          toast('Please sign in to review programs.', 'warning');
        } else {
          showFormErrors(form, err.fields || {}, err.message);
          toast(err.message, 'error');
        }
      } finally {
        busy(submit, false);
      }
    });
  }

  const trackBtn = document.querySelector('[data-track-application]');
  if (trackBtn) {
    trackBtn.addEventListener('click', async () => {
      if (!me) {
        toast('Sign in to track applications.', 'warning');
        setTimeout(() => (window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`), 700);
        return;
      }
      busy(trackBtn, true, 'Adding…');
      try {
        const data = await api('/api/creator/applications', { method: 'POST', body: { programId: p.id } });
        toast('Application tracked. Opening the official application page…', 'success');
        if (data.signupUrl) window.open(data.signupUrl, '_blank', 'noopener,noreferrer');
        trackBtn.innerHTML = '<i class="bi bi-check2-square"></i> Tracking: pending';
      } catch (err) {
        if (err.status === 409) toast(err.message, 'warning');
        else toast(err.message, 'error');
      } finally {
        busy(trackBtn, false);
      }
    });
  }
}

async function load() {
  try {
    const [data, me] = await Promise.all([api(`/api/programs/${encodeURIComponent(slug)}`), getMe()]);
    render(data.program, me);
    // Record a legitimate view once per browser session per program.
    const key = `affilink:viewed:${slug}`;
    if (!sessionStorage.getItem(key)) {
      api(`/api/programs/${encodeURIComponent(slug)}/view`, { method: 'POST' })
        .then(() => sessionStorage.setItem(key, '1'))
        .catch(() => {});
    }
  } catch (err) {
    root.setAttribute('aria-busy', 'false');
    root.innerHTML = `<div class="empty-state" style="margin:48px 0">
      <div class="icon"><i class="bi bi-compass"></i></div>
      <h3>${err.status === 404 ? 'Program not found' : 'Could not load this program'}</h3>
      <p>${escapeHtml(err.message)}</p>
      <a class="btn btn-primary" href="/programs">Browse all programs</a>
    </div>`;
  }
}

load();
