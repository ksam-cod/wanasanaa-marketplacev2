/** Small fetch wrapper plus formatting helpers shared by every page. */

export async function api(path, { method = 'GET', body, formData } = {}) {
  const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };

  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { message: 'Unexpected response from the server.' } };
  }

    if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

/** Kenyan shillings, always whole units (the M-Pesa API only accepts whole KES). */
export function money(value) {
  const amount = Number(value ?? 0);
  return `KSh ${amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function initials(name) {
  return String(name || 'W')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function stars(rating) {
  const rounded = Math.round(Number(rating) || 0);
  return '★★★★★'.slice(0, rounded).padEnd(5, '☆');
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function toast(message, tone = 'default') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const node = document.createElement('div');
  node.className = `toast${tone === 'error' ? ' toast--error' : tone === 'ok' ? ' toast--ok' : ''}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => node.remove(), 5200);
}

/** Guards a page that needs an account; returns the session or null after redirecting. */
export async function requireSession(redirect = true) {
  try {
    const session = await api('/api/auth/me');
    if (session.user) return session;
  } catch {
    /* fall through */
  }
  if (redirect) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
  }
  return null;
}
