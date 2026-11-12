import { cleanString, isHttpUrl, safeJsonArray, slugify } from './security.js';
import { one } from './db.js';

const TYPES = ['percentage', 'recurring', 'fixed', 'tiered'];

export async function validateProgramInput(body = {}, { partial = false } = {}) {
  const errors = {};
  const out = {};

  const required = (field) => {
    if (partial) return false;
    errors[field] = 'This field is required.';
    return true;
  };
  const set = (field, value) => {
    if (!(field in body) && partial) return;
    out[field] = value;
  };

  const brandName = cleanString(body.brandName, 80);
  if (!brandName && !required('brandName')) {
    /* nothing */
  } else if (!brandName) {
    errors.brandName = 'Brand name is required.';
  } else {
    out.brandName = brandName;
  }

  const title = cleanString(body.title, 120);
  if (title.length < 4) errors.title = 'Program title must be at least 4 characters.';
  else out.title = title;

  const description = cleanString(body.description, 2000);
  if (description.length < 30) errors.description = 'Describe the program in at least 30 characters.';
  else out.description = description;

  const categorySlug = cleanString(body.category, 60) || cleanString(body.categorySlug, 60);
  const category = categorySlug ? await one('SELECT id FROM categories WHERE slug = ?', categorySlug) : null;
  if (!category && !partial) errors.category = 'Choose a category.';
  else if (category) out.categoryId = category.id;
  else if (categorySlug && partial) errors.category = 'Choose a valid category.';

  const websiteUrl = cleanString(body.websiteUrl, 300);
  if (!websiteUrl) errors.websiteUrl = 'Brand website is required.';
  else if (!isHttpUrl(websiteUrl)) errors.websiteUrl = 'Enter a valid https:// URL.';
  else out.websiteUrl = websiteUrl;

  const signupUrl = cleanString(body.signupUrl, 300);
  if (!signupUrl) errors.signupUrl = 'Affiliate signup URL is required.';
  else if (!isHttpUrl(signupUrl)) errors.signupUrl = 'Enter a valid https:// URL.';
  else out.signupUrl = signupUrl;

  const commissionType = cleanString(body.commissionType, 20);
  if (!TYPES.includes(commissionType)) errors.commissionType = 'Choose a commission type.';
  else out.commissionType = commissionType;

  const commissionValue = Number(body.commissionValue);
  if (!Number.isFinite(commissionValue) || commissionValue <= 0) errors.commissionValue = 'Enter a commission value above 0.';
  else if (commissionType === 'percentage' || commissionType === 'recurring') {
    if (commissionValue > 100) errors.commissionValue = 'Percentage cannot exceed 100.';
    else out.commissionValue = Math.round(commissionValue * 100) / 100;
  } else out.commissionValue = Math.round(commissionValue * 100) / 100;

  let commissionLabel = cleanString(body.commissionLabel, 100);
  if (!commissionLabel) {
    if (commissionType === 'fixed') commissionLabel = `$${commissionValue} per signup`;
    else commissionLabel = `${commissionValue}% ${commissionType === 'recurring' ? 'recurring' : 'revenue share'}`;
  }
  out.commissionLabel = commissionLabel;

  const tiers = Array.isArray(body.commissionTiers)
    ? body.commissionTiers
        .filter((t) => t && cleanString(t.name, 40) && Number.isFinite(Number(t.rate)))
        .map((t) => ({ name: cleanString(t.name, 40), rate: Number(t.rate) }))
        .slice(0, 6)
    : [];
  out.commissionTiers = tiers.length ? JSON.stringify(tiers) : null;

  const cookieDays = Number(body.cookieDays);
  if (!Number.isFinite(cookieDays) || cookieDays < 1 || cookieDays > 730) errors.cookieDays = 'Cookie duration must be 1–730 days.';
  else out.cookieDays = Math.round(cookieDays);

  const minPayout = Number(body.minPayout);
  if (!Number.isFinite(minPayout) || minPayout < 0) errors.minPayout = 'Minimum payout must be 0 or more.';
  else out.minPayout = Math.round(minPayout * 100) / 100;

  const paymentFrequency = cleanString(body.paymentFrequency, 30) || 'Monthly';
  out.paymentFrequency = paymentFrequency;

  const paymentMethods = safeJsonArray(body.paymentMethods);
  if (!paymentMethods.length) errors.paymentMethods = 'Select at least one payment method.';
  else out.paymentMethods = JSON.stringify(paymentMethods);

  const network = cleanString(body.network, 60);
  if (!network) errors.network = 'Affiliate network is required.';
  else out.network = network;

  const eligibleCountries = cleanString(body.eligibleCountries, 120) || 'Worldwide';
  out.eligibleCountries = eligibleCountries;

  const promoMethods = safeJsonArray(body.promoMethods);
  if (!promoMethods.length) errors.promoMethods = 'Select at least one promotional method.';
  else out.promoMethods = JSON.stringify(promoMethods);

  const requirements = cleanString(body.requirements, 1500);
  if (!requirements) errors.requirements = 'Add program requirements so creators know what to expect.';
  else out.requirements = requirements;

  const contactEmail = cleanString(body.contactEmail, 160);
  if (!contactEmail) errors.contactEmail = 'Contact email is required.';
  else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contactEmail)) errors.contactEmail = 'Enter a valid email address.';
  else out.contactEmail = contactEmail;

  const logoUrl = cleanString(body.logoUrl, 400);
  if (logoUrl && !isHttpUrl(logoUrl) && !/^\/(?:logos|images)\/[a-z0-9._-]+$/i.test(logoUrl)) {
    errors.logoUrl = 'Logo must be an https:// URL or an uploaded asset path.';
  } else if (logoUrl) {
    out.logoUrl = logoUrl;
  }

  return { errors, data: out, hasErrors: Object.keys(errors).length > 0 };
}

export async function uniqueSlug(base, table = 'affiliate_programs', ignoreId = null) {
  const root = slugify(base);
  let candidate = root;
  let n = 2;
  while (true) {
    const row = ignoreId
      ? await one(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`, candidate, ignoreId)
      : await one(`SELECT id FROM ${table} WHERE slug = ?`, candidate);
    if (!row) return candidate;
    candidate = `${root}-${n++}`;
    if (n > 500) return `${root}-${Date.now()}`;
  }
}
