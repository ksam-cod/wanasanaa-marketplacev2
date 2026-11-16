import assert from 'node:assert/strict';
import { test } from 'node:test';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const stamp = Date.now();
const emails = {
  artist: `studio-${stamp}@wanasanaa.test`,
  rival: `rival-${stamp}@wanasanaa.test`,
  buyer: `buyer-${stamp}@wanasanaa.test`,
  other: `other-${stamp}@wanasanaa.test`,
};
const password = 'Test-Password-2026';

const state = {};

async function call(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return { status: response.status, data, cookie: setCookies[0]?.split(';')[0] };
}

async function register(payload) {
  const result = await call('/api/auth/register', { method: 'POST', body: payload });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(result.cookie, 'session cookie should be set');
  return result;
}

test('health and public marketplace config', async () => {
  const health = await call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.database, 'connected');

  const config = await call('/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.data.platform.currency, 'KES');
  assert.equal(config.data.payments.provider, 'mpesa');
});

test('studio registers and adds a priced artwork with stock', async () => {
  const created = await register({
    name: 'Test Studio',
    email: emails.artist,
    password,
    role: 'artist',
    studioName: 'Test Atelier',
    location: 'Nairobi',
  });
  assert.equal(created.data.user.role, 'artist');
  state.artistCookie = created.cookie;
  state.artistId = created.data.user.id;

  const artwork = await call('/api/artist/artworks', {
    method: 'POST',
    cookie: state.artistCookie,
    body: {
      title: 'Test Cyan Pendant',
      description: 'A test piece for the marketplace flow.',
      medium: 'Hand-forged silver and cyan quartz',
      category: 'Handcrafted Jewelry',
      metal: '925 Silver',
      gemstone: 'Paraíba & Cyan',
      dimensions: '30mm drop',
      price_kes: 15000,
      stock: 3,
      one_of_a_kind: false,
      image_url: 'https://example.com/pendant.jpg',
    },
  });

  assert.equal(artwork.status, 201, JSON.stringify(artwork.data));
  assert.equal(artwork.data.artwork.price_kes, 15000);
  assert.equal(artwork.data.artwork.stock, 3);
  state.artworkId = artwork.data.artwork.id;

  const dashboard = await call('/api/artist/summary', { cookie: state.artistCookie });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.currency, 'KES');
  assert.equal(dashboard.data.inventory.artworks, 1);
  assert.equal(dashboard.data.inventory.units_in_stock, 3);
  assert.equal(dashboard.data.earnings.total_net_kes, 0);
});

test('the studio can re-price a piece and set its stock', async () => {
  const patched = await call(`/api/artist/artworks/${state.artworkId}`, {
    method: 'PATCH',
    cookie: state.artistCookie,
    body: { price_kes: 18000, stock: 3 },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal(patched.data.artwork.price_kes, 18000);
  assert.equal(patched.data.artwork.stock, 3);
});

test('a different studio cannot edit the piece', async () => {
  const rival = await register({
    name: 'Rival Studio',
    email: emails.rival,
    password,
    role: 'artist',
    studioName: 'Rival Atelier',
  });
  state.rivalCookie = rival.cookie;

  const attempt = await call(`/api/artist/artworks/${state.artworkId}`, {
    method: 'PATCH',
    cookie: state.rivalCookie,
    body: { price_kes: 1 },
  });
  assert.equal(attempt.status, 404);

  const studioList = await call('/api/artist/artworks', { cookie: state.rivalCookie });
  assert.equal(studioList.data.artworks.length, 0);
});

test('collectors see published pieces with Kenyan shilling prices', async () => {
  const listing = await call('/api/artworks?limit=48');
  assert.equal(listing.status, 200);
  const piece = listing.data.artworks.find((row) => row.id === state.artworkId);
  assert.ok(piece, 'new piece should be listed');
  assert.equal(piece.price_kes, 18000);
  assert.equal(piece.category, 'Handcrafted Jewelry');
});

test('checkout requires an account and cannot exceed available stock', async () => {
  const anonymous = await call('/api/orders', {
    method: 'POST',
    body: {
      items: [{ artworkId: state.artworkId, quantity: 1 }],
      shipping: { name: 'A Buyer', phone: '0712345678', address: '12 Ngong Road', city: 'Nairobi' },
    },
  });
  assert.equal(anonymous.status, 401);

  const buyer = await register({ name: 'Test Buyer', email: emails.buyer, password });
  state.buyerCookie = buyer.cookie;

  const tooMany = await call('/api/orders', {
    method: 'POST',
    cookie: state.buyerCookie,
    body: {
      items: [{ artworkId: state.artworkId, quantity: 5 }],
      shipping: { name: 'Test Buyer', phone: '0712345678', address: '12 Ngong Road', city: 'Nairobi' },
    },
  });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.data.error.code, 'insufficient_stock');

  const collectorDashboard = await call('/api/artist/summary', { cookie: state.buyerCookie });
  assert.equal(collectorDashboard.status, 403);
});

test('checkout reserves stock and starts an M-Pesa STK request', async () => {
  const result = await call('/api/orders', {
    method: 'POST',
    cookie: state.buyerCookie,
    body: {
      items: [{ artworkId: state.artworkId, quantity: 2 }],
      phone: '0712 345 678',
      shipping: { name: 'Test Buyer', phone: '0712345678', address: '12 Ngong Road', city: 'Nairobi' },
      notes: 'Please pack with care.',
    },
  });

  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.order.total_kes, 36000);
  assert.equal(result.data.order.currency, 'KES');
  assert.equal(result.data.order.status, 'pending_payment');
  assert.equal(result.data.payment.phone, '254712345678');
  assert.ok(result.data.payment.checkout_request_id, 'checkout request id recorded');
  state.orderId = result.data.order.id;
  state.checkoutId = result.data.payment.checkout_request_id;
  state.orderTotal = result.data.order.total_kes;

  const stock = await call(`/api/artworks/${state.artworkId}`);
  assert.equal(stock.data.artwork.stock, 1);
});

test('settling the payment marks the order paid and writes artist earnings', async () => {
  const simulated = await call(`/api/orders/${state.orderId}/simulate-payment`, {
    method: 'POST',
    cookie: state.buyerCookie,
    body: { outcome: 'success' },
  });
  assert.equal(simulated.status, 200, JSON.stringify(simulated.data));
  assert.equal(simulated.data.order.status, 'paid');
  assert.match(simulated.data.order.payment.mpesa_receipt, /^SIM/);

  const summary = await call('/api/artist/summary', { cookie: state.artistCookie });
  assert.equal(summary.data.sales.gross_sales_kes, 36000);
  assert.equal(summary.data.earnings.platform_fees_kes, 4320);
  assert.equal(summary.data.earnings.total_net_kes, 31680);
  assert.equal(summary.data.sales.units_sold, 2);
  assert.equal(summary.data.inventory.units_in_stock, 1);

  const earnings = await call('/api/artist/earnings', { cookie: state.artistCookie });
  assert.equal(earnings.status, 200);
  assert.equal(earnings.data.currency, 'KES');
  assert.equal(earnings.data.earnings.length, 1);
  assert.equal(earnings.data.earnings[0].gross_kes, 36000);
  assert.equal(earnings.data.earnings[0].platform_fee_kes, 4320);
  assert.equal(earnings.data.earnings[0].net_kes, 31680);
  assert.equal(earnings.data.earnings[0].status, 'available');
});

test('paid orders cannot be cancelled and callbacks are idempotent', async () => {
  const cancel = await call(`/api/orders/${state.orderId}/cancel`, {
    method: 'POST',
    cookie: state.buyerCookie,
  });
  assert.equal(cancel.status, 409);

  const replay = await call('/api/webhooks/mpesa/callback', {
    method: 'POST',
    body: {
      Body: {
        stkCallback: {
          MerchantRequestID: 'replay',
          CheckoutRequestID: state.checkoutId,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: state.orderTotal },
              { Name: 'MpesaReceiptNumber', Value: 'REPLAY0001' },
            ],
          },
        },
      },
    },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.ResultCode, 0);

  const summary = await call('/api/artist/summary', { cookie: state.artistCookie });
  assert.equal(summary.data.earnings.total_net_kes, 31680, 'replayed callback must not double-credit');

  const unknown = await call('/api/webhooks/mpesa/callback', {
    method: 'POST',
    body: { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_NOT_REAL', ResultCode: 0 } } },
  });
  assert.equal(unknown.status, 200);
});

test('only verified buyers can review, one review per piece', async () => {
  const buyerReview = await call(`/api/artworks/${state.artworkId}/reviews`, {
    method: 'POST',
    cookie: state.buyerCookie,
    body: { rating: 5, title: 'Superb finish', body: 'Exactly as photographed and beautifully packaged.' },
  });
  assert.equal(buyerReview.status, 201, JSON.stringify(buyerReview.data));

  const duplicate = await call(`/api/artworks/${state.artworkId}/reviews`, {
    method: 'POST',
    cookie: state.buyerCookie,
    body: { rating: 4, body: 'Trying to review a second time should not work.' },
  });
  assert.equal(duplicate.status, 409);

  const other = await register({ name: 'Other Buyer', email: emails.other, password });
  state.otherCookie = other.cookie;

  const nonBuyer = await call(`/api/artworks/${state.artworkId}/reviews`, {
    method: 'POST',
    cookie: state.otherCookie,
    body: { rating: 5, body: 'I did not buy this piece, so this must be rejected.' },
  });
  assert.equal(nonBuyer.status, 409);
  assert.equal(nonBuyer.data.error.code, 'purchase_required');

  const detail = await call(`/api/artworks/${state.artworkId}`, { cookie: state.buyerCookie });
  assert.equal(detail.data.artwork.avg_rating, 5);
  assert.equal(detail.data.artwork.review_count, 1);
  assert.equal(detail.data.canReview, false);
  assert.ok(detail.data.myReview);
});

test('an inquiry is routed to the studio and its status can be updated', async () => {
  const inquiry = await call('/api/inquiries', {
    method: 'POST',
    cookie: state.buyerCookie,
    body: {
      artworkId: state.artworkId,
      name: 'Test Buyer',
      email: 'buyer@wanasanaa.test',
      phone: '0712345678',
      subject: 'Can this be resized?',
      message: 'I would like to discuss a slightly wider band for this pendant.',
      budgetKes: 90000,
    },
  });
  assert.equal(inquiry.status, 201, JSON.stringify(inquiry.data));
  assert.equal(inquiry.data.inquiry.status, 'new');

  const inbox = await call('/api/artist/inquiries', { cookie: state.artistCookie });
  assert.equal(inbox.status, 200);
  const received = inbox.data.inquiries.find((row) => row.id === inquiry.data.inquiry.id);
  assert.ok(received);
  assert.equal(received.artwork_title, 'Test Cyan Pendant');
  assert.equal(received.budget_kes, 90000);

  const updated = await call(`/api/artist/inquiries/${received.id}`, {
    method: 'PATCH',
    cookie: state.artistCookie,
    body: { status: 'replied' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.inquiry.status, 'replied');

  const forbidden = await call('/api/artist/inquiries', { cookie: state.buyerCookie });
  assert.equal(forbidden.status, 403);

  const summary = await call('/api/artist/summary', { cookie: state.artistCookie });
  assert.equal(summary.data.inquiries.total, 1);
  assert.equal(summary.data.inquiries.new, 0);
});

test('cancelling an unpaid order releases its reserved stock', async () => {
  const order = await call('/api/orders', {
    method: 'POST',
    cookie: state.otherCookie,
    body: {
      items: [{ artworkId: state.artworkId, quantity: 1 }],
      shipping: { name: 'Other Buyer', phone: '0798765432', address: '4 Westlands Ave', city: 'Nairobi' },
    },
  });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal(order.data.order.status, 'pending_payment');

  const afterReserve = await call(`/api/artworks/${state.artworkId}`);
  assert.equal(afterReserve.data.artwork.stock, 0);

  const cancelled = await call(`/api/orders/${order.data.order.id}/cancel`, {
    method: 'POST',
    cookie: state.otherCookie,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.order.status, 'cancelled');

  const afterCancel = await call(`/api/artworks/${state.artworkId}`);
  assert.equal(afterCancel.data.artwork.stock, 1);
});

test('anonymous collectors can inquire about a piece', async () => {
  const anonymous = await call('/api/inquiries', {
    method: 'POST',
    body: {
      artworkId: state.artworkId,
      name: 'Walk-in Collector',
      email: 'walkin@example.com',
      subject: 'Viewing request',
      message: 'Could I arrange a private viewing of this piece in Nairobi this week?',
    },
  });
  assert.equal(anonymous.status, 201, JSON.stringify(anonymous.data));
  assert.equal(anonymous.data.inquiry.status, 'new');
});

test('artwork validation rejects missing prices and negative stock', async () => {
  const missingPrice = await call('/api/artist/artworks', {
    method: 'POST',
    cookie: state.artistCookie,
    body: { title: 'No price', category: 'Handcrafted Jewelry' },
  });
  assert.equal(missingPrice.status, 422);

  const negative = await call(`/api/artist/artworks/${state.artworkId}`, {
    method: 'PATCH',
    cookie: state.artistCookie,
    body: { stock: -2 },
  });
  assert.equal(negative.status, 422);
});

test('logging out clears the session', async () => {
  const logout = await call('/api/auth/logout', { method: 'POST', cookie: state.buyerCookie });
  assert.equal(logout.status, 200);

  const me = await call('/api/auth/me', { cookie: state.buyerCookie });
  assert.equal(me.data.user, null, 'old cookie must not authenticate after logout is only client-side');
});
