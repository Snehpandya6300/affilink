import { api, init, busy, showFormErrors, clearFormErrors, toast } from './app.js';

init();

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const resetForm = document.getElementById('resetForm');
const nextPath = new URLSearchParams(window.location.search).get('next') || '';

function safeNext(fallback) {
  if (!nextPath) return fallback;
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) return fallback;
  return nextPath;
}

if (loginForm) {
  document.querySelectorAll('[data-fill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [email, password] = btn.dataset.fill.split('|');
      loginForm.elements.email.value = email;
      loginForm.elements.password.value = password;
      loginForm.elements.password.focus();
    });
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(loginForm);
    const email = loginForm.elements.email.value.trim();
    const password = loginForm.elements.password.value;
    const fields = {};
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) fields.email = 'Enter a valid email address.';
    if (!password) fields.password = 'Enter your password.';
    if (Object.keys(fields).length) return showFormErrors(loginForm, fields, 'Please fill in both fields.');

    const submit = loginForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Signing in…');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      toast(`Welcome back, ${data.user.name.split(' ')[0]}.`, 'success');
      window.location.href = safeNext(data.redirect);
    } catch (err) {
      showFormErrors(loginForm, err.fields || {}, err.message);
      toast(err.message, 'error');
      busy(submit, false);
    }
  });
}

if (registerForm) {
  const roleInputs = Array.from(registerForm.querySelectorAll('input[name="role"]'));
  const companyField = document.getElementById('companyField');
  const companyInput = companyField.querySelector('input');
  const requestedRole = new URLSearchParams(window.location.search).get('role');
  if (requestedRole === 'brand') {
    roleInputs.forEach((r) => (r.checked = r.value === 'brand'));
  }
  const syncRole = () => {
    const role = registerForm.querySelector('input[name="role"]:checked').value;
    companyField.hidden = role !== 'brand';
    companyInput.required = role === 'brand';
  };
  roleInputs.forEach((r) => r.addEventListener('change', syncRole));
  syncRole();

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(registerForm);
    const body = {
      name: registerForm.elements.name.value.trim(),
      email: registerForm.elements.email.value.trim(),
      password: registerForm.elements.password.value,
      role: registerForm.querySelector('input[name="role"]:checked').value,
      companyName: companyInput.value.trim(),
    };
    const fields = {};
    if (body.name.length < 2) fields.name = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.email)) fields.email = 'Enter a valid email address.';
    if (body.password.length < 8) fields.password = 'Use at least 8 characters.';
    else if (!/[a-zA-Z]/.test(body.password) || !/[0-9]/.test(body.password)) fields.password = 'Include at least one letter and one number.';
    if (body.role === 'brand' && body.companyName.length < 2) fields.companyName = 'Enter your company name.';
    if (!registerForm.elements.terms.checked) fields.terms = 'Please accept the terms to continue.';
    if (Object.keys(fields).length) return showFormErrors(registerForm, fields, 'Please fix the highlighted fields.');

    const submit = registerForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Creating account…');
    try {
      const data = await api('/api/auth/register', { method: 'POST', body });
      toast('Account created. Welcome to Affilink.', 'success');
      window.location.href = safeNext(data.redirect);
    } catch (err) {
      showFormErrors(registerForm, err.fields || {}, err.message);
      toast(err.message, 'error');
      busy(submit, false);
    }
  });
}

if (forgotForm) {
  forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(forgotForm);
    const email = forgotForm.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      return showFormErrors(forgotForm, { email: 'Enter a valid email address.' }, 'Enter the email on your account.');
    }
    const submit = forgotForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Generating link…');
    try {
      const data = await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      const box = document.getElementById('resetSuccess');
      if (data.demoResetUrl) {
        box.hidden = false;
        document.getElementById('demoResetLink').href = data.demoResetUrl;
      } else {
        toast('If that email exists, a reset link has been generated.', 'success');
      }
      forgotForm.reset();
    } catch (err) {
      showFormErrors(forgotForm, err.fields || {}, err.message);
      toast(err.message, 'error');
    } finally {
      busy(submit, false);
    }
  });
}

if (resetForm) {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  if (!token) {
    document.getElementById('missingToken').hidden = false;
    resetForm.querySelector('button[type="submit"]').disabled = true;
  }
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(resetForm);
    const password = resetForm.elements.password.value;
    const confirm = resetForm.elements.confirm.value;
    const fields = {};
    if (password.length < 8) fields.password = 'Use at least 8 characters.';
    else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) fields.password = 'Include at least one letter and one number.';
    if (password !== confirm) fields.confirm = 'Passwords do not match.';
    if (Object.keys(fields).length) return showFormErrors(resetForm, fields, 'Please fix the highlighted fields.');

    const submit = resetForm.querySelector('button[type="submit"]');
    busy(submit, true, 'Updating…');
    try {
      const data = await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
      toast(data.message || 'Password updated.', 'success');
      setTimeout(() => (window.location.href = '/login'), 900);
    } catch (err) {
      showFormErrors(resetForm, err.fields || {}, err.message);
      toast(err.message, 'error');
      busy(submit, false);
    }
  });
}
