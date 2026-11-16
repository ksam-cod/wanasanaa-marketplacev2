import { api, toast } from './api.js';
import { bootChrome } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);

function safeNext() {
  const next = params.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return null;
}

function setTab(name) {
  const signIn = name === 'signin';
  $('#tab-signin').setAttribute('aria-selected', String(signIn));
  $('#tab-register').setAttribute('aria-selected', String(!signIn));
  $('#signin-form').hidden = !signIn;
  $('#register-form').hidden = signIn;
}

function setRole(role) {
  const artist = role === 'artist';
  $('#artist-fields').hidden = !artist;
  document.querySelector(`input[name="role"][value="${role}"]`).checked = true;
}

function syncArtistFields() {
  const role = document.querySelector('input[name="role"]:checked')?.value || 'collector';
  $('#artist-fields').hidden = role !== 'artist';
}

async function signIn(event) {
  event.preventDefault();
  const status = $('#signin-status');
  status.className = 'form-status';
  status.textContent = 'Signing in…';

  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: $('#signin-email').value.trim(),
        password: $('#signin-password').value,
      },
    });
    toast(`Welcome back, ${user.name.split(' ')[0]}.`, 'ok');
    location.href = safeNext() || (user.role === 'artist' ? '/dashboard.html' : '/');
  } catch (error) {
    status.className = 'form-status is-error';
    status.textContent = error.message;
  }
}

async function register(event) {
  event.preventDefault();
  const status = $('#register-status');
  status.className = 'form-status';
  status.textContent = 'Creating your account…';

  const role = document.querySelector('input[name="role"]:checked')?.value || 'collector';

  try {
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: $('#register-name').value.trim(),
        email: $('#register-email').value.trim(),
        password: $('#register-password').value,
        role,
        studioName: role === 'artist' ? $('#register-studio').value.trim() || undefined : undefined,
        location: role === 'artist' ? $('#register-location').value.trim() || undefined : undefined,
        discipline: role === 'artist' ? $('#register-discipline').value.trim() || undefined : undefined,
        bio: role === 'artist' ? $('#register-bio').value.trim() || undefined : undefined,
      },
    });
    toast('Account created. Welcome to Wanasanaa.', 'ok');
    location.href = role === 'artist' ? '/dashboard.html' : safeNext() || '/';
    return user;
  } catch (error) {
    status.className = 'form-status is-error';
    status.textContent = error.details?.[0]?.message || error.message;
  }
}

async function init() {
  const session = await bootChrome();
  if (session?.user) {
    location.href = safeNext() || (session.user.role === 'artist' ? '/dashboard.html' : '/');
    return;
  }

  $('#tab-signin').addEventListener('click', () => setTab('signin'));
  $('#tab-register').addEventListener('click', () => setTab('register'));
  $('#signin-form').addEventListener('submit', signIn);
  $('#register-form').addEventListener('submit', register);
  document.querySelectorAll('input[name="role"]').forEach((input) => {
    input.addEventListener('change', syncArtistFields);
  });

  if (params.get('role') === 'artist') {
    setTab('register');
    setRole('artist');
  }
}

init();
