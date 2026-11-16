import { api, escapeHtml, money, toast } from './api.js';
import { bootChrome, cartTotal, clearCart, getCart, refreshCartCount, saveCart } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const state = { session: null, order: null, simulated: false, pollTimer: null, config: null, busy: false };

function renderCart() {
  const cart = getCart();
  const items = $('#cart-items');

  items.innerHTML = cart
    .map(
      (item) => `
      <div class="line-item" data-id="${escapeHtml(item.id)}">
        <div class="art-media thumb">
          <img src="${escapeHtml(item.image_url || '')}" alt="${escapeHtml(item.title)}">
        </div>
        <div class="line-item__body">
          <h4>${escapeHtml(item.title)}</h4>
          <p class="small muted">${escapeHtml(item.studio_name || 'Studio piece')} · ${item.stock <= 1 ? 'Unique piece' : `${item.stock} available`}</p>
          <div class="row" style="gap:6px;margin-top:4px">
            <div class="qty">
              <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
              <input value="${item.quantity}" readonly aria-label="Quantity">
              <button type="button" data-step="1" aria-label="Increase quantity">+</button>
            </div>
            <button class="link-btn" type="button" data-remove>Remove</button>
          </div>
        </div>
        <div style="text-align:right">
          <span class="price" style="font-size:14px">${money(item.price_kes * item.quantity)}</span>
          <p class="small muted">${money(item.price_kes)} each</p>
        </div>
      </div>`,
    )
    .join('');

  const empty = cart.length === 0;
  $('#cart-empty').hidden = !empty;
  $('#cart-totals').hidden = empty;
  $('#basket-count').textContent = empty ? '' : `${cart.reduce((n, item) => n + item.quantity, 0)} pieces`;

  const subtotal = cartTotal();
  const shipping = Number(state.config?.platform?.shippingKes ?? 0);
  $('#subtotal').textContent = money(subtotal);
  $('#shipping').textContent = shipping === 0 ? 'Complimentary' : money(shipping);
  $('#total').textContent = money(subtotal + shipping);

  $('#place-order').disabled = empty || state.busy || Boolean(state.order);
  $('#pay-amount').textContent = money(subtotal + shipping);

  refreshCartCount();
}

function setBusy(busy) {
  state.busy = busy;
  $('#place-order').disabled = busy || getCart().length === 0 || Boolean(state.order);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function renderPaymentPanel(message) {
  const order = state.order;
  if (!order) return;
  const panel = $('#payment-panel');
  panel.hidden = false;
  panel.innerHTML = `
    <div class="payment-box">
      <div class="row" style="justify-content:space-between">
        <span class="row" style="gap:8px"><span class="status-dot"></span><strong style="font-size:13px">${escapeHtml(message || 'Waiting for M-Pesa')}</strong></span>
        <span class="small muted">${escapeHtml(order.order_number)}</span>
      </div>
      <p class="small muted">A prompt was sent to your phone for <strong>${money(order.total_kes)}</strong>. Enter your M-Pesa PIN to approve. This page updates automatically.</p>
      ${
        state.simulated
          ? `<button class="btn btn--primary btn--sm" type="button" id="simulate-pay">Complete test payment</button>
             <p class="form-note">Simulation mode: no Daraja credentials are configured, so this button acts as the customer's approved PIN prompt.</p>`
          : ''
      }
      <button class="link-btn" type="button" id="cancel-order">Cancel this order and release the pieces</button>
    </div>`;
}

function renderSuccess(order) {
  stopPolling();
  $('#payment-panel').hidden = true;
  $('#checkout-form').hidden = true;
  $('#signin-note').hidden = true;

  const panel = $('#success-panel');
  panel.hidden = false;
  panel.innerHTML = `
    <div class="success-box">
      <h3>Payment received</h3>
      <p class="small">Thank you — the studio has been notified and will begin packing your acquisition.</p>
      <p class="small"><strong>Order</strong> ${escapeHtml(order.order_number)}</p>
      ${order.payment?.mpesa_receipt ? `<p class="small"><strong>M-Pesa receipt</strong></p><p class="receipt">${escapeHtml(order.payment.mpesa_receipt)}</p>` : ''}
      <p class="small"><strong>Total paid</strong> ${money(order.total_kes)}</p>
      ${order.payment?.simulated ? '<p class="small muted">Recorded in simulation mode for local testing.</p>' : ''}
      <div class="row" style="margin-top:6px">
        <a class="btn btn--ghost btn--sm" href="/#archive">Continue collecting</a>
        <a class="btn btn--quiet btn--sm" href="/artwork.html?id=${escapeHtml(order.items?.[0]?.artwork_id || '')}">Review your piece</a>
      </div>
    </div>`;
  clearCart();
  renderCart();
}

async function refreshOrder() {
  if (!state.order) return null;
  try {
    const { order } = await api(`/api/orders/${state.order.id}`);
    state.order = order;

    if (order.status === 'paid' || order.status === 'fulfilled') {
      renderSuccess(order);
    } else if (order.payment?.status === 'failed') {
      stopPolling();
      renderPaymentPanel(order.payment.result_desc || 'The payment was not completed. Try again.');
    }
    return order;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    const order = await refreshOrder();
    if (!order || order.status !== 'pending_payment') stopPolling();
  }, 4000);
}

async function placeOrder(event) {
  event.preventDefault();
  if (state.order) return;

  if (!state.session?.user) {
    location.href = '/login.html?next=%2Fcheckout.html';
    return;
  }

  const form = event.currentTarget;
  const data = new FormData(form);
  const status = $('#checkout-status');

  const items = getCart().map((item) => ({ artworkId: item.id, quantity: item.quantity }));
  if (!items.length) return;

  setBusy(true);
  status.className = 'form-status';
  status.textContent = 'Reserving your pieces and sending the M-Pesa prompt…';

  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: {
        items,
        phone: String(data.get('mpesaPhone') || '').trim(),
        shipping: {
          name: String(data.get('name') || '').trim(),
          phone: String(data.get('phone') || '').trim(),
          address: String(data.get('address') || '').trim(),
          city: String(data.get('city') || '').trim(),
        },
        notes: String(data.get('notes') || '').trim() || undefined,
      },
    });

    state.order = result.order;
    state.simulated = Boolean(result.simulated);
    form.hidden = true;
    status.textContent = '';

    if (result.paymentError) {
      $('#payment-panel').hidden = false;
      $('#payment-panel').innerHTML = `
        <div class="payment-box">
          <p class="small" style="color:var(--danger)">${escapeHtml(result.paymentError)}</p>
          <p class="small muted">Your pieces are reserved under ${escapeHtml(result.order.order_number)}. Retry the M-Pesa prompt below.</p>
          <button class="btn btn--primary btn--sm" type="button" id="retry-payment">Retry M-Pesa prompt</button>
        </div>`;
      $('#retry-payment').addEventListener('click', async () => {
        try {
          const retry = await api(`/api/orders/${state.order.id}/pay`, {
            method: 'POST',
            body: { phone: String(data.get('mpesaPhone') || '').trim() },
          });
          state.simulated = Boolean(retry.simulated);
          renderPaymentPanel('Prompt sent — check your phone');
          startPolling();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    } else {
      renderPaymentPanel('Prompt sent — check your phone');
      startPolling();
    }
  } catch (error) {
    status.className = 'form-status is-error';
    status.textContent = error.message;
    if (error.code === 'insufficient_stock' && Array.isArray(error.details)) {
      toast(error.details[0]?.message || 'A piece sold out while you were checking out.', 'error');
    }
  } finally {
    setBusy(false);
  }
}

function bindCartEvents() {
  $('#cart-items').addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const cart = getCart();
    const item = cart.find((entry) => entry.id === row.dataset.id);
    if (!item) return;

    if (event.target.closest('[data-remove]')) {
      saveCart(cart.filter((entry) => entry.id !== item.id));
      renderCart();
      return;
    }

    const step = event.target.closest('[data-step]');
    if (step) {
      const next = item.quantity + Number(step.dataset.step);
      item.quantity = Math.min(item.stock, Math.max(1, next));
      saveCart(cart);
      renderCart();
    }
  });
}

function bindPaymentEvents() {
  $('#payment-panel').addEventListener('click', async (event) => {
    const simulate = event.target.closest('#simulate-pay');
    if (simulate) {
      simulate.disabled = true;
      simulate.textContent = 'Completing…';
      try {
        await api(`/api/orders/${state.order.id}/simulate-payment`, {
          method: 'POST',
          body: { outcome: 'success' },
        });
        await refreshOrder();
      } catch (error) {
        toast(error.message, 'error');
        simulate.disabled = false;
        simulate.textContent = 'Complete test payment';
      }
    }

    if (event.target.closest('#cancel-order')) {
      try {
        await api(`/api/orders/${state.order.id}/cancel`, { method: 'POST' });
        stopPolling();
        state.order = null;
        $('#payment-panel').hidden = true;
        $('#checkout-form').hidden = false;
        renderCart();
        toast('Order cancelled. The pieces are back in the archive.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

async function init() {
  state.session = await bootChrome();
  try {
    state.config = await api('/api/config');
  } catch {
    /* defaults */
  }

  if (!state.session?.user) $('#signin-note').hidden = false;

  if (state.session?.user) {
    $('#ship-name').value = state.session.user.name || '';
    if (state.session.user.phone) {
      $('#ship-phone').value = state.session.user.phone;
      $('#payment-phone').value = state.session.user.phone;
    }
  }

  $('#ship-phone').addEventListener('input', (event) => {
    if (!$('#payment-phone').value) $('#payment-phone').value = event.target.value;
  });

  $('#checkout-form').addEventListener('submit', placeOrder);
  bindCartEvents();
  bindPaymentEvents();
  renderCart();

  // Restore an in-flight order after a refresh.
  try {
    const { orders } = await api('/api/orders');
    const pending = orders?.find((order) => order.status === 'pending_payment');
    if (pending) {
      const { order } = await api(`/api/orders/${pending.id}`);
      state.order = order;
      state.simulated = Boolean(order.payment?.simulated);
      $('#checkout-form').hidden = true;
      renderPaymentPanel(order.payment?.status === 'failed' ? 'Payment not completed' : 'Waiting for M-Pesa');
      if (order.payment?.status !== 'failed') startPolling();
    }
  } catch {
    /* signed out or no orders */
  }
}

init();
