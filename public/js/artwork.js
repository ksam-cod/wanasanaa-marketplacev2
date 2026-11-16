import { api, escapeHtml, formatDate, initials, money, stars, toast } from './api.js';
import { addToCart, bootChrome } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const artworkId = new URLSearchParams(location.search).get('id');
const state = { artwork: null, quantity: 1, session: null };

function stockText(artwork) {
  if (artwork.stock <= 0) return 'Currently sold out';
  return `<strong>${artwork.stock}</strong> ${artwork.stock === 1 ? 'piece' : 'pieces'} available`;
}

function renderReviews(data) {
  const { artwork, reviews } = data;
  const summary = $('#review-summary');
  summary.innerHTML = artwork.review_count > 0
    ? `<span class="stars">${stars(artwork.avg_rating)}</span> ${Number(artwork.avg_rating).toFixed(1)} · ${artwork.review_count} ${artwork.review_count === 1 ? 'review' : 'reviews'}`
    : '<span class="muted small">Awaiting the first review</span>';

  $('#review-list').innerHTML = reviews
    .map(
      (review) => `
      <article class="review">
        <div class="review__head">
          <span>${escapeHtml(review.reviewer)} · verified acquisition</span>
          <span>${formatDate(review.created_at)}</span>
        </div>
        <span class="stars" aria-label="${review.rating} out of 5">${stars(review.rating)}</span>
        ${review.title ? `<h4>${escapeHtml(review.title)}</h4>` : ''}
        <p>${escapeHtml(review.body)}</p>
      </article>`,
    )
    .join('');

  $('#review-empty').hidden = reviews.length > 0;

  const form = $('#review-form');
  const locked = $('#review-locked');
  form.hidden = !data.canReview;
  locked.hidden = data.canReview;

  if (!data.canReview) {
    if (!data.signedIn) {
      locked.innerHTML = '<a href="/login.html" style="color:var(--primary)">Sign in</a> to review the piece after it arrives.';
    } else if (data.myReview) {
      locked.textContent = 'Thank you — your review for this piece is published.';
    } else {
      locked.textContent = 'Reviews are reserved for collectors who have acquired this piece through Wanasanaa.';
    }
  }
}

async function loadDetail() {
  if (!artworkId) {
    $('#detail-error').hidden = false;
    return;
  }

  try {
    const data = await api(`/api/artworks/${encodeURIComponent(artworkId)}`);
    const artwork = data.artwork;
    state.artwork = artwork;

    $('#detail-content').hidden = false;
    $('#detail-image').src = artwork.image_url || '';
    $('#detail-image').alt = artwork.title;
    $('#detail-category').textContent = `${artwork.category} // ${artwork.studio_name}`;
    $('#detail-title').textContent = artwork.title;
    $('#detail-medium').textContent = artwork.medium || '';
    $('#detail-description').textContent = artwork.description || '';
    $('#detail-tag').textContent = artwork.one_of_a_kind ? 'One of a kind' : stockText(artwork).replace(/<[^>]+>/g, '');
    $('#detail-price').innerHTML = `${money(artwork.price_kes)} <small>KES</small>`;
    $('#detail-stock').innerHTML = stockText(artwork);

    $('#detail-specs').innerHTML = [
      ['Metal', artwork.metal],
      ['Stone', artwork.gemstone],
      ['Dimensions', artwork.dimensions],
      ['Edition', artwork.one_of_a_kind ? 'Unique piece' : 'Limited casting'],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');

    $('#studio-name').textContent = artwork.studio_name;
    $('#studio-location').textContent = artwork.artist_location || 'Independent studio';
    $('#studio-initials').textContent = initials(artwork.studio_name);
    $('#studio-bio').textContent = artwork.artist_bio || '';
    $('#studio-verified').hidden = !artwork.verified;

    const soldOut = artwork.stock <= 0;
    $('#qty').value = String(state.quantity);
    $('#add-to-basket').disabled = soldOut;
    $('#buy-now').disabled = soldOut;
    $('#qty-up').disabled = soldOut || state.quantity >= artwork.stock;
    $('#qty-down').disabled = state.quantity <= 1;

    renderReviews(data);
    document.title = `${artwork.title} — Wanasanaa Contemporary`;
  } catch (error) {
    $('#detail-error').hidden = false;
    $('#detail-error').textContent = error.status === 404
      ? 'That piece could not be found.'
      : error.message;
  }
}

function bindActions() {
  $('#qty-up').addEventListener('click', () => {
    const max = state.artwork?.stock || 1;
    state.quantity = Math.min(max, state.quantity + 1);
    $('#qty').value = String(state.quantity);
    $('#qty-up').disabled = state.quantity >= max;
    $('#qty-down').disabled = state.quantity <= 1;
  });

  $('#qty-down').addEventListener('click', () => {
    state.quantity = Math.max(1, state.quantity - 1);
    $('#qty').value = String(state.quantity);
    $('#qty-down').disabled = state.quantity <= 1;
    $('#qty-up').disabled = false;
  });

  $('#add-to-basket').addEventListener('click', () => {
    if (!state.artwork) return;
    addToCart(state.artwork, state.quantity);
    toast(`${state.artwork.title} added to your basket.`, 'ok');
  });

  $('#buy-now').addEventListener('click', () => {
    if (!state.artwork) return;
    addToCart(state.artwork, state.quantity);
    location.href = '/checkout.html';
  });

  $('#review-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('#review-status');
    status.className = 'form-status';
    status.textContent = 'Publishing…';

    try {
      await api(`/api/artworks/${artworkId}/reviews`, {
        method: 'POST',
        body: {
          rating: Number($('#review-rating').value),
          title: $('#review-title').value.trim() || undefined,
          body: $('#review-body').value.trim(),
        },
      });
      toast('Your review is published. Thank you.', 'ok');
      await loadDetail();
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.message;
    }
  });

  $('#inquiry-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $('#inquiry-status');
    status.className = 'form-status';
    status.textContent = 'Sending…';

    const data = new FormData(form);
    const budget = Number(data.get('budget'));

    try {
      const result = await api('/api/inquiries', {
        method: 'POST',
        body: {
          artworkId,
          name: String(data.get('name') || '').trim(),
          email: String(data.get('email') || '').trim(),
          phone: String(data.get('phone') || '').trim() || undefined,
          subject: `Inquiry — ${state.artwork?.title || 'studio piece'}`,
          message: String(data.get('message') || '').trim(),
          budgetKes: budget > 0 ? budget : undefined,
        },
      });
      status.className = 'form-status is-ok';
      status.textContent = result.message;
      form.reset();
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.message;
    }
  });
}

async function init() {
  state.session = await bootChrome();
  bindActions();

  if (state.session?.user) {
    $('#inquiry-name').value = state.session.user.name;
    $('#inquiry-email').value = state.session.user.email;
  }

  await loadDetail();
}

init();
