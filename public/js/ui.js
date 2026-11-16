import { api, initials } from './api.js';

const CART_KEY = 'wanasanaa.cart.v1';

export function getCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  refreshCartCount();
  document.dispatchEvent(new CustomEvent('cart:change'));
}

export function addToCart(artwork, quantity = 1) {
  const cart = getCart();
  const existing = cart.find((item) => item.id === artwork.id);
  const limit = Math.max(1, Number(artwork.stock) || 1);

  if (existing) {
    existing.quantity = Math.min(limit, existing.quantity + quantity);
    existing.price_kes = artwork.price_kes;
    existing.stock = limit;
  } else {
    cart.push({
      id: artwork.id,
      title: artwork.title,
      price_kes: artwork.price_kes,
      image_url: artwork.image_url,
      studio_name: artwork.studio_name,
      stock: limit,
      quantity: Math.min(limit, quantity),
    });
  }

  saveCart(cart);
  return cart;
}

export function removeFromCart(id) {
  saveCart(getCart().filter((item) => item.id !== id));
}

export function clearCart() {
  saveCart([]);
}

export function cartTotal() {
  return getCart().reduce((total, item) => total + item.price_kes * item.quantity, 0);
}

export function cartCount() {
  return getCart().reduce((count, item) => count + item.quantity, 0);
}

export function refreshCartCount() {
  const count = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach((node) => {
    node.textContent = String(count);
    node.hidden = count === 0;
  });
}

/** Wires the shared header/footer behaviour and returns the current session. */
export async function bootChrome() {
  refreshCartCount();
  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  let session = { user: null, artist: null };
  try {
    session = await api('/api/auth/me');
  } catch {
    /* signed out */
  }

  const user = session.user;
  document.querySelectorAll('[data-auth="out"]').forEach((node) => { node.hidden = Boolean(user); });
  document.querySelectorAll('[data-auth="in"]').forEach((node) => { node.hidden = !user; });
  document.querySelectorAll('[data-auth="studio"]').forEach((node) => {
    node.hidden = !(user && user.role === 'artist');
  });
  document.querySelectorAll('[data-auth="collector"]').forEach((node) => {
    node.hidden = !user || user.role !== 'collector';
  });
  document.querySelectorAll('[data-user-name]').forEach((node) => {
    node.textContent = user ? user.name.split(' ')[0] : '';
  });

  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } finally {
        localStorage.removeItem('wanasanaa.user');
        location.href = '/';
      }
    });
  });

  // Graceful placeholder when an artwork photo cannot be loaded.
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const media = image.closest('.art-media, .thumb');
      if (!media) return;
      media.classList.add('is-missing');
      if (!media.dataset.fallback) {
        media.dataset.fallback = initials(image.alt || 'Wanasanaa');
      }
    },
    true,
  );

  return session;
}

export function artworkHref(id) {
  return `/artwork.html?id=${encodeURIComponent(id)}`;
}
