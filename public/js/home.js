import { api, escapeHtml, money, stars, toast } from './api.js';
import { addToCart, artworkHref, bootChrome } from './ui.js';

const state = {
  page: 1,
  limit: 12,
  pages: 1,
  category: '',
  metal: '',
  q: '',
  sort: 'curated',
  artworks: new Map(),
  featured: null,
  session: null,
};

const $ = (selector) => document.querySelector(selector);

function stockLabel(artwork) {
  if (artwork.stock <= 0) return 'Sold';
  if (artwork.stock === 1) return 'One available';
  return `${artwork.stock} available`;
}

function renderCard(artwork) {
  state.artworks.set(artwork.id, artwork);
  const tag = artwork.one_of_a_kind ? 'One of a kind' : artwork.is_featured ? 'Curator’s pick' : artwork.category;
  const rating = Number(artwork.avg_rating) > 0
    ? `<span class="rating"><span class="stars">${stars(artwork.avg_rating)}</span> ${Number(artwork.avg_rating).toFixed(1)} (${artwork.review_count})</span>`
    : '<span class="rating muted">No reviews yet</span>';

  return `
    <article class="art-card">
      <a class="art-media" href="${artworkHref(artwork.id)}" aria-label="View ${escapeHtml(artwork.title)}">
        <img src="${escapeHtml(artwork.image_url || '')}" alt="${escapeHtml(artwork.title)}" loading="lazy">
        <span class="tag-float">${escapeHtml(tag)}</span>
      </a>
      <div class="art-card__body">
        <div class="art-card__meta">
          <span>${escapeHtml(artwork.metal || artwork.category)}</span>
          <strong>${escapeHtml(stockLabel(artwork))}</strong>
        </div>
        <h3><a href="${artworkHref(artwork.id)}">${escapeHtml(artwork.title)}</a></h3>
        <p class="italic">${escapeHtml(artwork.medium || 'Handcrafted studio piece')}</p>
        <p class="small muted">Studio: ${escapeHtml(artwork.studio_name)} • ${escapeHtml(artwork.artist_location || 'Independent')}</p>
        ${rating}
      </div>
      <div class="art-card__foot">
        <span class="price">${money(artwork.price_kes)}</span>
        <button class="btn btn--quiet btn--sm" type="button" data-acquire="${escapeHtml(artwork.id)}">Acquire</button>
      </div>
    </article>`;
}

async function loadArtworks(reset = false) {
  if (reset) {
    state.page = 1;
    state.artworks.clear();
    $('#artwork-grid').innerHTML = '';
  }

  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
    sort: state.sort,
  });
  if (state.category) params.set('category', state.category);
  if (state.metal) params.set('metal', state.metal);
  if (state.q) params.set('q', state.q);

  try {
    const data = await api(`/api/artworks?${params}`);
    state.pages = data.pagination.pages;
    const grid = $('#artwork-grid');
    grid.insertAdjacentHTML('beforeend', data.artworks.map(renderCard).join(''));

    $('#archive-empty').hidden = grid.children.length > 0;
    $('#load-more').hidden = state.page >= state.pages;
    $('#result-count').textContent = `${data.pagination.total} studio ${data.pagination.total === 1 ? 'work' : 'works'}`;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadFeatured() {
  try {
    const { artwork } = await api('/api/artworks/featured');
    if (!artwork) return;
    state.featured = artwork;
    state.artworks.set(artwork.id, artwork);

    $('#spotlight').hidden = false;
    $('#spotlight-image').src = artwork.image_url || '';
    $('#spotlight-image').alt = artwork.title;
    $('#spotlight-title').textContent = artwork.title;
    $('#spotlight-medium').textContent = artwork.medium || artwork.category;
    $('#spotlight-description').textContent = artwork.description || '';
    $('#spotlight-studio').textContent = `${artwork.studio_name} • ${artwork.artist_location || 'Independent studio'}`;
    $('#spotlight-tag').textContent = artwork.one_of_a_kind ? 'One of a kind' : 'Limited casting';
    $('#spotlight-price').innerHTML = `${money(artwork.price_kes)} <small>KES</small>`;
    $('#spotlight-detail').href = artworkHref(artwork.id);
    $('#spotlight-specs').innerHTML = [
      ['Metal', artwork.metal],
      ['Stone', artwork.gemstone],
      ['Dimensions', artwork.dimensions],
      ['Availability', stockLabel(artwork)],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');
  } catch (error) {
    console.error(error);
  }
}

function chip(label, value, active) {
  return `<button class="chip" type="button" data-value="${escapeHtml(value)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
}

async function loadFacets() {
  try {
    const facets = await api('/api/artworks/facets');
    $('#category-chips').innerHTML =
      chip('All disciplines', '', !state.category) +
      facets.categories.map((row) => chip(row.value, row.value, row.value === state.category)).join('');

    $('#metal-chips').innerHTML =
      chip('All metals', '', !state.metal) +
      facets.metals.map((row) => chip(row.value, row.value, row.value === state.metal)).join('');
  } catch (error) {
    console.error(error);
  }

  $('#category-chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    state.category = button.dataset.value;
    document.querySelectorAll('#category-chips .chip').forEach((node) => {
      node.setAttribute('aria-pressed', String(node === button));
    });
    loadArtworks(true);
  });

  $('#metal-chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    state.metal = button.dataset.value;
    document.querySelectorAll('#metal-chips .chip').forEach((node) => {
      node.setAttribute('aria-pressed', String(node === button));
    });
    loadArtworks(true);
  });
}

async function loadStudios() {
  try {
    const { artists } = await api('/api/artists');
    $('#commission-studio').insertAdjacentHTML(
      'beforeend',
      artists
        .map((artist) => `<option value="${escapeHtml(artist.id)}">${escapeHtml(artist.studio_name)} — ${escapeHtml(artist.location || 'Independent')}</option>`)
        .join(''),
    );
  } catch (error) {
    console.error(error);
  }
}

function bindArchiveActions() {
  $('#artwork-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-acquire]');
    if (!button) return;
    const artwork = state.artworks.get(button.dataset.acquire);
    if (!artwork) return;
    addToCart(artwork, 1);
    toast(`${artwork.title} added to your basket.`, 'ok');
  });

  $('#spotlight-acquire').addEventListener('click', () => {
    if (!state.featured) return;
    addToCart(state.featured, 1);
    toast(`${state.featured.title} added to your basket.`, 'ok');
  });

  $('#load-more').addEventListener('click', async () => {
    state.page += 1;
    await loadArtworks(false);
  });

  let timer;
  $('#search-input').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = event.target.value.trim();
      loadArtworks(true);
    }, 300);
  });

  $('#sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    loadArtworks(true);
  });
}

function bindCommissionForm() {
  const form = $('#commission-form');
  const status = $('#commission-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'form-status';
    status.textContent = 'Sending your brief…';

    const data = new FormData(form);
    const budget = Number(data.get('budget'));
    const artistId = String(data.get('artistId') || '');

    try {
      const result = await api('/api/inquiries', {
        method: 'POST',
        body: {
          name: String(data.get('name') || '').trim(),
          email: String(data.get('email') || '').trim(),
          subject: `Commission inquiry — ${data.get('object')}`,
          message: String(data.get('message') || '').trim(),
          budgetKes: budget || undefined,
          artistId: artistId || undefined,
        },
      });
      status.className = 'form-status is-ok';
      status.textContent = result.message;
      form.reset();
      if (state.session?.user) {
        form.elements.name.value = state.session.user.name;
        form.elements.email.value = state.session.user.email;
      }
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.message;
    }
  });
}

async function init() {
  state.session = await bootChrome();

  if (state.session?.user) {
    $('#commission-name').value = state.session.user.name;
    $('#commission-email').value = state.session.user.email;
  }

  bindArchiveActions();
  bindCommissionForm();

  await Promise.all([loadFeatured(), loadFacets(), loadStudios(), loadArtworks(true)]);
  document.title = 'Wanasanaa Contemporary — Artisan jewellery & wearable sculpture';
}

init();
