import { api, escapeHtml, formatDate, money, toast } from './api.js';
import { bootChrome } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const state = { summary: null, artworks: [], session: null };

function kpi(label, value, hint, accent = false) {
  return `
    <div class="kpi${accent ? ' kpi--accent' : ''}">
      <span class="label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>`;
}

function renderSummary(summary) {
  const earnings = summary.earnings;
  const sales = summary.sales;
  const inventory = summary.inventory;

  $('#studio-title').textContent = summary.artist.studio_name;
  $('#studio-meta').textContent = [
    summary.artist.location || 'Independent studio',
    `${Math.round(Number(summary.artist.commission_rate) * 100)}% platform commission`,
    summary.artist.verified ? 'Verified studio' : 'Verification pending',
  ].join(' · ');

  $('#kpis').innerHTML = [
    kpi('Available balance', money(earnings.available_kes), 'Settled to your studio', true),
    kpi('Total earned (net)', money(earnings.total_net_kes), `${earnings.sold_lines} pieces sold`),
    kpi('Awaiting payment', money(earnings.awaiting_payment_kes), `${earnings.awaiting_payment_orders} orders at M-Pesa`),
    kpi('Pieces in stock', String(inventory.units_in_stock), `${inventory.published} published works`),
    kpi('Units sold', String(sales.units_sold), `${sales.paid_orders} paid orders`),
    kpi('Collectors', String(sales.customers), summary.reviews.review_count > 0 ? `Avg rating ${Number(summary.reviews.average_rating).toFixed(1)}` : 'No reviews yet'),
  ].join('');

  $('#earnings-totals').innerHTML = `
    <div><span>Gross sales</span><span>${money(sales.gross_sales_kes)}</span></div>
    <div><span>Platform commission</span><span>− ${money(earnings.platform_fees_kes)}</span></div>
    <div><span>Available balance</span><span>${money(earnings.available_kes)}</span></div>
    <div class="grand"><span>Total net earned</span><span>${money(earnings.total_net_kes)}</span></div>`;

  $('#monthly-earnings').innerHTML = summary.monthly_earnings.length
    ? summary.monthly_earnings
        .map((row) => `<div><span>${escapeHtml(row.month)}</span><span>${money(row.net_kes)}</span></div>`)
        .join('')
    : '<p class="small muted">No settled months yet.</p>';

  $('#commission-note').textContent =
    `Gross sales ${money(sales.gross_sales_kes)} · studio commission ${money(earnings.platform_fees_kes)} · ${inventory.out_of_stock} sold-out works.`;

  $('#inventory-summary').textContent =
    `${inventory.artworks} works · ${inventory.units_in_stock} in stock · ${inventory.out_of_stock} sold out`;

  $('#inquiry-badge').textContent = `${summary.inquiries.new} new`;

  renderSales(summary.recent_sales);
}

function renderSales(sales) {
  $('#sales-body').innerHTML = sales
    .map(
      (sale) => `
      <tr>
        <td><strong>${escapeHtml(sale.title)}</strong></td>
        <td>${escapeHtml(sale.buyer_name)}</td>
        <td class="small muted">${escapeHtml(sale.order_number)}</td>
        <td class="small muted">${formatDate(sale.paid_at)}</td>
        <td class="num">${money(sale.line_total_kes)}</td>
        <td class="num">${money(sale.net_kes)}</td>
      </tr>`,
    )
    .join('');
  $('#sales-empty').hidden = sales.length > 0;
}

function renderInventory() {
  const rows = state.artworks.map(
    (artwork) => `
    <tr data-id="${escapeHtml(artwork.id)}">
      <td>
        <div class="cell-title">
          <span class="art-media thumb"><img src="${escapeHtml(artwork.image_url || '')}" alt="${escapeHtml(artwork.title)}"></span>
          <span>
            <strong>${escapeHtml(artwork.title)}</strong>
            <small>${escapeHtml(artwork.category)}${artwork.one_of_a_kind ? ' · unique' : ''}</small>
          </span>
        </div>
      </td>
      <td class="num">
        <div class="inline-edit">
          <input type="number" min="1" step="1" value="${artwork.price_kes}" data-price aria-label="Price in KES for ${escapeHtml(artwork.title)}">
        </div>
      </td>
      <td class="num">
        <div class="inline-edit">
          <input type="number" min="0" step="1" value="${artwork.stock}" data-stock aria-label="Pieces available for ${escapeHtml(artwork.title)}">
        </div>
      </td>
      <td class="num">${artwork.units_sold}</td>
      <td class="num">${money(artwork.revenue_kes)}</td>
      <td><span class="status-pill status-pill--${escapeHtml(artwork.status)}">${escapeHtml(artwork.status)}</span></td>
      <td>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          <button class="btn btn--quiet btn--sm" type="button" data-save>Save</button>
          <button class="btn btn--danger btn--sm" type="button" data-archive>Archive</button>
        </div>
      </td>
    </tr>`,
  );

  $('#inventory-body').innerHTML = rows.join('');
  $('#inventory-empty').hidden = rows.length > 0;
}

function renderCustomers(customers) {
  $('#customer-body').innerHTML = customers
    .map(
      (customer) => `
      <tr>
        <td>
          <strong>${escapeHtml(customer.name)}</strong><br>
          <span class="small muted">${escapeHtml(customer.email)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}</span>
        </td>
        <td class="num">${customer.pieces}</td>
        <td class="num">${money(customer.spend_kes)}</td>
        <td class="small muted">${formatDate(customer.last_order_at)}</td>
      </tr>`,
    )
    .join('');
  $('#customer-empty').hidden = customers.length > 0;
  $('#customer-count').textContent = `${customers.length} ${customers.length === 1 ? 'collector' : 'collectors'}`;
}

function renderLedger(entries) {
  $('#ledger-body').innerHTML = entries
    .map(
      (entry) => `
      <tr>
        <td class="small muted">${formatDate(entry.created_at)}</td>
        <td><strong>${escapeHtml(entry.artwork_title)}</strong></td>
        <td class="small muted">${escapeHtml(entry.order_number)}</td>
        <td class="num">${money(entry.gross_kes)}</td>
        <td class="num">${money(entry.platform_fee_kes)}</td>
        <td class="num"><strong>${money(entry.net_kes)}</strong></td>
        <td><span class="status-pill status-pill--paid">${escapeHtml(entry.status)}</span></td>
      </tr>`,
    )
    .join('');
  $('#ledger-empty').hidden = entries.length > 0;
}

function renderInquiries(inquiries) {
  $('#inquiry-list').innerHTML = inquiries
    .map(
      (inquiry) => `
      <article class="inquiry-item" data-id="${escapeHtml(inquiry.id)}">
        <header>
          <div>
            <h4>${escapeHtml(inquiry.subject)}</h4>
            <p class="meta">${escapeHtml(inquiry.name)} · ${escapeHtml(inquiry.email)}${inquiry.phone ? ` · ${escapeHtml(inquiry.phone)}` : ''}</p>
          </div>
          <span class="status-pill status-pill--${escapeHtml(inquiry.status)}">${escapeHtml(inquiry.status)}</span>
        </header>
        ${inquiry.artwork_title ? `<p class="meta">About: ${escapeHtml(inquiry.artwork_title)}</p>` : ''}
        <p>${escapeHtml(inquiry.message)}</p>
        <div class="row" style="justify-content:space-between;align-items:flex-end">
          <span class="meta">${inquiry.budget_kes ? `Budget ${money(inquiry.budget_kes)}` : 'No budget stated'} · ${formatDate(inquiry.created_at)}</span>
          <span class="row" style="gap:6px">
            <a class="btn btn--ghost btn--sm" href="mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(`Re: ${inquiry.subject}`)}">Reply</a>
            <select class="control" data-status aria-label="Inquiry status" style="width:auto;padding:5px 8px;font-size:11.5px">
              <option value="new"${inquiry.status === 'new' ? ' selected' : ''}>New</option>
              <option value="replied"${inquiry.status === 'replied' ? ' selected' : ''}>Replied</option>
              <option value="closed"${inquiry.status === 'closed' ? ' selected' : ''}>Closed</option>
            </select>
          </span>
        </div>
      </article>`,
    )
    .join('');
  $('#inquiry-empty').hidden = inquiries.length > 0;
}

async function loadAll() {
  try {
    const [summary, artworks, earnings, customers, inquiries] = await Promise.all([
      api('/api/artist/summary'),
      api('/api/artist/artworks'),
      api('/api/artist/earnings'),
      api('/api/artist/customers'),
      api('/api/artist/inquiries'),
    ]);

    state.summary = summary;
    state.artworks = artworks.artworks;

    renderSummary(summary);
    renderInventory();
    renderCustomers(customers.customers);
    renderLedger(earnings.earnings);
    renderInquiries(inquiries.inquiries);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveRow(row) {
  const id = row.dataset.id;
  const price = Number(row.querySelector('[data-price]').value);
  const stock = Number(row.querySelector('[data-stock]').value);

  if (!Number.isInteger(price) || price < 1) {
    toast('The price tag must be a whole number of shillings.', 'error');
    return;
  }
  if (!Number.isInteger(stock) || stock < 0) {
    toast('Pieces available cannot be negative.', 'error');
    return;
  }

  const button = row.querySelector('[data-save]');
  button.disabled = true;
  try {
    await api(`/api/artist/artworks/${id}`, {
      method: 'PATCH',
      body: { price_kes: price, stock },
    });
    toast('Price tag and stock updated.', 'ok');
    await loadAll();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function archiveRow(row) {
  const artwork = state.artworks.find((item) => item.id === row.dataset.id);
  if (!artwork) return;
  if (!window.confirm(`Archive “${artwork.title}”? It will be removed from the public archive.`)) return;

  try {
    await api(`/api/artist/artworks/${artwork.id}`, { method: 'DELETE' });
    toast('Piece archived.', 'ok');
    await loadAll();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  $('#open-add').addEventListener('click', () => {
    $('#add-panel').hidden = false;
    $('#add-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#art-title').focus({ preventScroll: true });
  });

  $('#close-add').addEventListener('click', () => {
    $('#add-panel').hidden = true;
  });

  $('#inventory-body').addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    if (event.target.closest('[data-save]')) saveRow(row);
    if (event.target.closest('[data-archive]')) archiveRow(row);
  });

  $('#inquiry-list').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-status]');
    if (!select) return;
    const card = select.closest('[data-id]');
    try {
      await api(`/api/artist/inquiries/${card.dataset.id}`, {
        method: 'PATCH',
        body: { status: select.value },
      });
      toast('Inquiry updated.', 'ok');
      const [summary, inquiries] = await Promise.all([
        api('/api/artist/summary'),
        api('/api/artist/inquiries'),
      ]);
      renderSummary(summary);
      renderInquiries(inquiries.inquiries);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#artwork-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $('#art-status-message');
    const button = $('#art-submit');
    const formData = new FormData(form);

    status.className = 'form-status';
    status.textContent = 'Publishing…';
    button.disabled = true;

    try {
      await api('/api/artist/artworks', { method: 'POST', formData });
      toast('Piece added to the archive.', 'ok');
      form.reset();
      $('#art-stock').value = '1';
      status.className = 'form-status is-ok';
      status.textContent = 'Published. Collectors can now acquire it.';
      $('#add-panel').hidden = true;
      await loadAll();
    } catch (error) {
      status.className = 'form-status is-error';
      status.textContent = error.details?.length
        ? error.details.map((detail) => detail.message).join(' ')
        : error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function init() {
  state.session = await bootChrome();

  if (!state.session?.user) {
    $('#gate').hidden = false;
    $('#dashboard').hidden = true;
    return;
  }

  if (state.session.user.role !== 'artist') {
    $('#gate').hidden = false;
    $('#gate-title').textContent = 'Studio accounts only';
    $('#gate-message').textContent =
      'You are signed in as a collector. Studio inventory and earnings are available to artist accounts.';
    document.querySelector('#gate a.btn--ghost').href = '/#archive';
    document.querySelector('#gate a.btn--ghost').textContent = 'Browse the archive';
    $('#dashboard').hidden = true;
    return;
  }

  $('#gate').hidden = true;
  $('#dashboard').hidden = false;
  bindEvents();
  await loadAll();
}

init();
