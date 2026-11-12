import {
  api, init, escapeHtml, initials, getMe, requireUserRedirect, toast, busy,
  showFormErrors, clearFormErrors, formData, $, $$,
} from './app.js';

init();

const form = document.getElementById('programForm');
const match = window.location.pathname.match(/^\/brand\/programs\/(\d+)\/edit$/);
const editId = match ? Number(match[1]) : null;
let categories = [];

function labelValue() {
  const type = form.elements.commissionType.value;
  const value = Number(form.elements.commissionValue.value) || 0;
  const custom = form.elements.commissionLabel.value.trim();
  if (custom) return custom;
  if (!value) return '—';
  if (type === 'fixed') return `$${value} per signup`;
  if (type === 'recurring') return `${value}% recurring`;
  if (type === 'tiered') return `Up to ${value}%`;
  return `${value}% revenue share`;
}

function syncPreview() {
  const brand = form.elements.brandName.value.trim() || 'Your brand';
  const title = form.elements.title.value.trim() || 'Program title';
  const desc = form.elements.description.value.trim() || 'Your description will appear here.';
  $('#previewBrand').textContent = brand;
  $('#previewTitle').textContent = title;
  $('#previewDesc').textContent = desc.slice(0, 180) + (desc.length > 180 ? '…' : '');
  $('#previewCommission').textContent = labelValue();
  $('#previewCookie').textContent = form.elements.cookieDays.value ? `${form.elements.cookieDays.value} days` : '—';
  $('#previewNetwork').textContent = form.elements.network.value || '—';
  const payment = $$('input[name="paymentMethods[]"]:checked').map((i) => i.value)[0];
  $('#previewPayment').textContent = payment || '—';
  const cat = categories.find((c) => c.slug === form.elements.category.value);
  $('#previewCategory').textContent = cat ? cat.name : 'Category';
  const logo = form.elements.logoUrl.value.trim();
  $('#previewLogo').src = logo || '/logos/affilink.svg';
  const avatar = $('[data-user-avatar]');
  if (avatar && !avatar.querySelector('img')) avatar.textContent = initials(brand);
}

async function boot() {
  const me = await getMe();
  if (!requireUserRedirect(me, 'brand')) return;
  const avatar = $('[data-user-avatar]');
  if (avatar) avatar.innerHTML = me.brandProfile?.logoUrl ? `<img src="${escapeHtml(me.brandProfile.logoUrl)}" alt="">` : escapeHtml(initials(me.brandProfile?.companyName || me.name));
  $('[data-user-name]').textContent = me.brandProfile?.companyName || me.name;

  try {
    const data = await api('/api/categories');
    categories = data.categories;
    form.elements.category.innerHTML =
      '<option value="">Select a category…</option>' + categories.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
  } catch (err) {
    toast('Could not load categories.', 'error');
  }

  if (editId) {
    document.getElementById('formTitle').textContent = 'Edit program';
    document.getElementById('formSub').textContent = 'Update your listing. Changes are resubmitted for review before going live.';
    document.getElementById('editNotice').hidden = false;
    document.getElementById('submitBtn').textContent = 'Save & resubmit for review';
    try {
      const { program } = await api(`/api/brand/programs/${editId}`);
      form.elements.brandName.value = program.brandName;
      form.elements.title.value = program.title;
      form.elements.description.value = program.description;
      form.elements.category.value = program.category?.slug || '';
      form.elements.websiteUrl.value = program.websiteUrl || '';
      form.elements.signupUrl.value = program.signupUrl || '';
      form.elements.commissionType.value = program.commissionType;
      form.elements.commissionValue.value = program.commissionValue;
      form.elements.commissionLabel.value = program.commissionLabel || '';
      form.elements.cookieDays.value = program.cookieDays;
      form.elements.minPayout.value = program.minPayout;
      form.elements.paymentFrequency.value = program.paymentFrequency;
      form.elements.network.value = program.network;
      form.elements.eligibleCountries.value = program.eligibleCountries || 'Worldwide';
      form.elements.requirements.value = program.requirements || '';
      form.elements.contactEmail.value = program.contactEmail || '';
      form.elements.logoUrl.value = program.logoUrl?.startsWith('/logos/') && !program.logoUrl.includes('affilink') ? '' : program.logoUrl || '';
      $$('input[name="paymentMethods[]"]').forEach((i) => (i.checked = (program.paymentMethods || []).includes(i.value)));
      $$('input[name="promoMethods[]"]').forEach((i) => (i.checked = (program.promoMethods || []).includes(i.value)));
      syncPreview();
    } catch (err) {
      toast(err.message, 'error');
      if (err.status === 404) setTimeout(() => (window.location.href = '/brand/dashboard?programs'), 900);
    }
  }
  syncPreview();
}

form.addEventListener('input', syncPreview);
form.addEventListener('change', syncPreview);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  const raw = formData(form);
  const body = {
    brandName: form.elements.brandName.value.trim(),
    title: form.elements.title.value.trim(),
    logoUrl: form.elements.logoUrl.value.trim(),
    category: form.elements.category.value,
    description: form.elements.description.value.trim(),
    websiteUrl: form.elements.websiteUrl.value.trim(),
    signupUrl: form.elements.signupUrl.value.trim(),
    commissionType: form.elements.commissionType.value,
    commissionValue: Number(form.elements.commissionValue.value),
    commissionLabel: form.elements.commissionLabel.value.trim(),
    cookieDays: Number(form.elements.cookieDays.value),
    minPayout: Number(form.elements.minPayout.value),
    paymentFrequency: form.elements.paymentFrequency.value,
    network: form.elements.network.value,
    eligibleCountries: form.elements.eligibleCountries.value.trim() || 'Worldwide',
    requirements: form.elements.requirements.value.trim(),
    contactEmail: form.elements.contactEmail.value.trim(),
    paymentMethods: [].concat(raw['paymentMethods'] || []),
    promoMethods: [].concat(raw['promoMethods'] || []),
  };

  const fields = {};
  if (body.brandName.length < 2) fields.brandName = 'Enter your brand name.';
  if (body.title.length < 4) fields.title = 'Enter a program title.';
  if (body.description.length < 30) fields.description = 'Write at least 30 characters.';
  if (!body.category) fields.category = 'Choose a category.';
  if (!/^https?:\/\/.+\..+/.test(body.websiteUrl)) fields.websiteUrl = 'Enter a full https:// URL.';
  if (!/^https?:\/\/.+\..+/.test(body.signupUrl)) fields.signupUrl = 'Enter a full https:// URL.';
  if (!(body.commissionValue > 0)) fields.commissionValue = 'Enter a commission value above 0.';
  if (!(body.cookieDays >= 1)) fields.cookieDays = 'Cookie duration must be at least 1 day.';
  if (!(body.minPayout >= 0)) fields.minPayout = 'Minimum payout must be 0 or more.';
  if (!body.network) fields.network = 'Choose an affiliate network.';
  if (!body.paymentMethods.length) fields.paymentMethods = 'Select at least one payment method.';
  if (!body.promoMethods.length) fields.promoMethods = 'Select at least one promotional method.';
  if (body.requirements.length < 10) fields.requirements = 'Add program requirements.';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.contactEmail)) fields.contactEmail = 'Enter a valid email address.';
  if (Object.keys(fields).length) {
    showFormErrors(form, fields, 'Please fix the highlighted fields.');
    const firstError = Object.keys(fields)[0];
    form.elements[firstError]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const submit = document.getElementById('submitBtn');
  busy(submit, true, editId ? 'Saving…' : 'Submitting…');
  try {
    if (editId) {
      await api(`/api/brand/programs/${editId}`, { method: 'PUT', body });
      toast('Changes saved and resubmitted for review.', 'success');
    } else {
      await api('/api/brand/programs', { method: 'POST', body });
      toast('Program submitted for review.', 'success');
    }
    document.getElementById('submitSuccess').hidden = false;
    document.getElementById('submitSuccessText').textContent = editId
      ? 'Changes saved. Your listing is back in the review queue.'
      : 'Program submitted. It will appear in the directory once approved.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => (window.location.href = '/brand/dashboard?programs'), 1100);
  } catch (err) {
    showFormErrors(form, err.fields || {}, err.message);
    toast(err.message, 'error');
    busy(submit, false);
  }
});

boot();
