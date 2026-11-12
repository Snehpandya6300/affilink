import { api, init, busy, showFormErrors, clearFormErrors, toast } from './app.js';

init();
const form = document.getElementById('contactForm');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(form);
  const body = {
    name: form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    topic: form.elements.topic.value,
    message: form.elements.message.value.trim(),
  };
  const fields = {};
  if (body.name.length < 2) fields.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.email)) fields.email = 'Enter a valid email address.';
  if (body.message.length < 20) fields.message = 'Please add a little more detail.';
  if (Object.keys(fields).length) return showFormErrors(form, fields, 'Please fix the highlighted fields.');
  const submit = form.querySelector('button[type="submit"]');
  busy(submit, true, 'Sending…');
  try {
    await api('/api/contact', { method: 'POST', body });
    form.reset();
    document.getElementById('contactSuccess').hidden = false;
    document.getElementById('contactSuccess').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showFormErrors(form, err.fields || {}, err.message);
    toast(err.message, 'error');
  } finally {
    busy(submit, false);
  }
});
