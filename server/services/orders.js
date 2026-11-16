import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { ApiError, badRequest, conflict, forbidden, normalizeKenyanPhone, notFound } from '../lib/http.js';
import { initiateStkPush, parseCallback } from './mpesa.js';

const PAID_STATUSES = "('paid', 'fulfilled')";

export function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    phone: row.phone,
    amount_kes: row.amount_kes,
    simulated: row.simulated,
    checkout_request_id: row.checkout_request_id,
    merchant_request_id: row.merchant_request_id,
    mpesa_receipt: row.mpesa_receipt,
    result_code: row.result_code,
    result_desc: row.result_desc,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function orderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  return `WS-${stamp}-${suffix}`;
}

/** Loads an order with items, studio names and its latest payment attempt. */
export async function getOrder(orderId, client = { query }) {
  const { rows } = await client.query(
    `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email
       FROM orders o JOIN users u ON u.id = o.buyer_id
      WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw notFound('Order not found.');

  const items = await client.query(
    `SELECT oi.*, ar.studio_name, a.image_url, a.medium
       FROM order_items oi
       JOIN artists ar ON ar.id = oi.artist_id
       LEFT JOIN artworks a ON a.id = oi.artwork_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at`,
    [orderId],
  );
  const payments = await client.query(
    `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );

  return { ...order, items: items.rows, payment: publicPayment(payments.rows[0]) };
}

export async function listOrdersForBuyer(userId) {
  const { rows } = await query(
    `SELECT o.*, COUNT(oi.id)::int AS item_count, COALESCE(SUM(oi.quantity), 0)::int AS unit_count
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.buyer_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Creates an order and reserves stock for every piece. The reservation is
 * released if the order is cancelled, so pieces cannot be oversold while a
 * customer is on the M-Pesa prompt.
 */
export async function createOrder({ user, items, shipping, notes }) {
  const wanted = new Map();
  for (const item of items) {
    wanted.set(item.artworkId, (wanted.get(item.artworkId) ?? 0) + item.quantity);
  }
  const ids = [...wanted.keys()];

  return withTransaction(async (client) => {
    const { rows: artworks } = await client.query(
      `SELECT a.id, a.title, a.price_kes, a.stock, a.status, a.artist_id, ar.commission_rate
         FROM artworks a JOIN artists ar ON ar.id = a.artist_id
        WHERE a.id = ANY($1::uuid[])
        FOR UPDATE OF a`,
      [ids],
    );
    const byId = new Map(artworks.map((row) => [row.id, row]));

    const problems = [];
    for (const [artworkId, quantity] of wanted) {
      const artwork = byId.get(artworkId);
      if (!artwork || artwork.status !== 'published') {
        problems.push({ artworkId, message: 'This piece is no longer available.' });
      } else if (artwork.stock < quantity) {
        problems.push({
          artworkId,
          message: `Only ${artwork.stock} ${artwork.stock === 1 ? 'piece' : 'pieces'} available.`,
        });
      }
    }
    if (problems.length) {
      throw new ApiError(409, 'insufficient_stock', 'Some pieces are no longer available.', problems);
    }

    let subtotal = 0;
    for (const [artworkId, quantity] of wanted) {
      subtotal += byId.get(artworkId).price_kes * quantity;
    }
    const shippingKes = config.platform.shippingKes;
    const total = subtotal + shippingKes;

    const { rows: created } = await client.query(
      `INSERT INTO orders
         (order_number, buyer_id, subtotal_kes, shipping_kes, total_kes,
          shipping_name, shipping_phone, shipping_address, shipping_city, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        orderNumber(),
        user.id,
        subtotal,
        shippingKes,
        total,
        shipping.name,
        shipping.phone,
        shipping.address,
        shipping.city,
        notes || null,
      ],
    );
    const order = created[0];

    for (const [artworkId, quantity] of wanted) {
      const artwork = byId.get(artworkId);
      const lineTotal = artwork.price_kes * quantity;
      await client.query(
        `INSERT INTO order_items
           (order_id, artwork_id, artist_id, title, quantity, unit_price_kes, line_total_kes, commission_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          artworkId,
          artwork.artist_id,
          artwork.title,
          quantity,
          artwork.price_kes,
          lineTotal,
          artwork.commission_rate,
        ],
      );
      await client.query('UPDATE artworks SET stock = stock - $2 WHERE id = $1', [
        artworkId,
        quantity,
      ]);
    }

    return getOrder(order.id, client);
  });
}

async function loadOwnedOrder(orderId, userId) {
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = rows[0];
  if (!order) throw notFound('Order not found.');
  if (order.buyer_id !== userId) throw forbidden('This order belongs to another account.');
  return order;
}

/** Starts (or restarts) an STK Push for a pending order. */
export async function initiatePayment({ orderId, user, phone }) {
  const order = await loadOwnedOrder(orderId, user.id);
  if (order.status === 'cancelled') throw conflict('This order was cancelled.');
  if (order.status !== 'pending_payment') {
    throw conflict('This order has already been paid.', 'already_paid');
  }

  const normalisedPhone = normalizeKenyanPhone(phone);
  const simulate = config.mpesa.simulate;

  const { rows } = await query(
    `INSERT INTO payments (order_id, phone, amount_kes, simulated, status)
     VALUES ($1, $2, $3, $4, 'initiated') RETURNING *`,
    [orderId, normalisedPhone, order.total_kes, simulate],
  );
  const payment = rows[0];

  if (simulate) {
    const checkoutRequestId = `ws_CO_SIM_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const { rows: updated } = await query(
      `UPDATE payments
          SET checkout_request_id = $2, merchant_request_id = $3,
              result_desc = 'Simulated STK Push (no Daraja credentials configured)'
        WHERE id = $1 RETURNING *`,
      [payment.id, checkoutRequestId, `SIM-${randomUUID().slice(0, 8)}`],
    );
    return { payment: publicPayment(updated[0]), simulated: true };
  }

  try {
    const response = await initiateStkPush({
      phone: normalisedPhone,
      amountKes: order.total_kes,
      accountReference: order.order_number,
      description: 'Wanasanaa',
    });
    const { rows: updated } = await query(
      `UPDATE payments
          SET checkout_request_id = $2, merchant_request_id = $3, result_desc = $4
        WHERE id = $1 RETURNING *`,
      [payment.id, response.checkoutRequestId, response.merchantRequestId, response.customerMessage],
    );
    return { payment: publicPayment(updated[0]), simulated: false };
  } catch (error) {
    await query(
      `UPDATE payments SET status = 'failed', result_desc = $2, completed_at = now() WHERE id = $1`,
      [payment.id, error.message?.slice(0, 500) ?? 'STK Push failed'],
    );
    throw error;
  }
}

/**
 * Applies a Daraja callback (or a simulated result) exactly once.
 * Marks the payment, settles the order, and writes the artist earnings ledger.
 */
export async function settlePayment({
  checkoutRequestId,
  resultCode,
  resultDesc,
  receipt,
  amount,
  phone,
  merchantRequestId,
  rawPayload,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, o.total_kes AS order_total_kes, o.status AS order_status
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.checkout_request_id = $1
        FOR UPDATE OF p, o`,
      [checkoutRequestId],
    );
    const payment = rows[0];
    if (!payment) return { found: false, settled: false };
    if (payment.status === 'succeeded') return { found: true, settled: false, alreadyProcessed: true };

    if (paymentOrderCancelled(payment)) {
      await client.query(
        `UPDATE payments
            SET status = 'succeeded', mpesa_receipt = $2, result_code = $3,
                result_desc = $4, raw_payload = $5, completed_at = now()
          WHERE id = $1 AND status <> 'succeeded'`,
        [
          payment.id,
          receipt,
          resultCode,
          `${resultDesc ?? 'Payment received'} (order was cancelled — refund required)`,
          rawPayload ?? null,
        ],
      );
      return { found: true, settled: false, refundRequired: true };
    }

    if (Number(resultCode) !== 0) {
      await client.query(
        `UPDATE payments
            SET status = 'failed', result_code = $2, result_desc = $3,
                raw_payload = $4, completed_at = now()
          WHERE id = $1`,
        [payment.id, Number(resultCode), resultDesc ?? 'Payment cancelled', rawPayload ?? null],
      );
      return { found: true, settled: false, failed: true };
    }

    if (amount != null && Number(amount) < payment.amount_kes) {
      await client.query(
        `UPDATE payments
            SET status = 'failed', result_code = $2, result_desc = $3,
                raw_payload = $4, completed_at = now()
          WHERE id = $1`,
        [payment.id, Number(resultCode), `Amount mismatch: paid ${amount}, expected ${payment.amount_kes}`, rawPayload ?? null],
      );
      return { found: true, settled: false, failed: true };
    }

    if (!receipt) {
      await client.query(
        `UPDATE payments
            SET status = 'failed', result_code = $2, result_desc = $3,
                raw_payload = $4, completed_at = now()
          WHERE id = $1`,
        [payment.id, Number(resultCode), 'Callback did not include an M-Pesa receipt', rawPayload ?? null],
      );
      return { found: true, settled: false, failed: true };
    }

    const duplicate = await client.query('SELECT id FROM payments WHERE mpesa_receipt = $1', [receipt]);
    if (duplicate.rows.length) {
      await client.query(
        `UPDATE payments
            SET status = 'failed', result_code = $2, result_desc = $3,
                raw_payload = $4, completed_at = now()
          WHERE id = $1`,
        [payment.id, Number(resultCode), `Duplicate receipt ${receipt}`, rawPayload ?? null],
      );
      return { found: true, settled: false, failed: true };
    }

    await client.query(
      `UPDATE payments
          SET status = 'succeeded', mpesa_receipt = $2, result_code = $3,
              result_desc = $4, merchant_request_id = COALESCE($5, merchant_request_id),
              raw_payload = $6, completed_at = now()
        WHERE id = $1`,
      [payment.id, receipt, Number(resultCode), resultDesc ?? 'Paid', merchantRequestId ?? null, rawPayload ?? null],
    );

    await client.query(
      `UPDATE orders SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status = 'pending_payment'`,
      [payment.order_id],
    );

    // Artist earnings: gross sale minus the agreed studio commission, in KES.
    await client.query(
      `INSERT INTO earnings
         (order_item_id, order_id, artwork_id, artist_id, gross_kes, platform_fee_kes, net_kes)
       SELECT oi.id, oi.order_id, oi.artwork_id, oi.artist_id, oi.line_total_kes,
              ROUND(oi.line_total_kes * oi.commission_rate)::int,
              oi.line_total_kes - ROUND(oi.line_total_kes * oi.commission_rate)::int
         FROM order_items oi
        WHERE oi.order_id = $1
       ON CONFLICT (order_item_id) DO NOTHING`,
      [payment.order_id],
    );

    return { found: true, settled: true, orderId: payment.order_id, paymentId: payment.id };
  });
}

function paymentOrderCancelled(payment) {
  return payment.order_status === 'cancelled';
}

/** Handles Daraja's POST body. Returns an ACK either way so Safaricom stops retrying. */
export async function handleMpesaCallback(body) {
  const parsed = parseCallback(body);
  if (!parsed) return { acknowledged: true, ignored: true };
  try {
    const result = await settlePayment({ ...parsed, rawPayload: body });
    return { acknowledged: true, ...result };
  } catch (error) {
    console.error('[mpesa] callback processing error', error);
    return { acknowledged: true, error: true };
  }
}

/** Development-only: completes a simulated STK Push for the buyer's own order. */
export async function simulatePaymentResult({ orderId, user, outcome = 'success', receipt }) {
  if (!config.mpesa.simulate) {
    throw forbidden('Simulated payments are disabled. Configure Daraja credentials.');
  }
  const order = await loadOwnedOrder(orderId, user.id);
  const { rows } = await query(
    `SELECT * FROM payments
      WHERE order_id = $1 AND status = 'initiated' AND simulated = true
      ORDER BY created_at DESC LIMIT 1`,
    [order.id],
  );
  const payment = rows[0];
  if (!payment) throw conflict('There is no pending simulated payment for this order.');

  if (outcome === 'failed') {
    return settlePayment({
      checkoutRequestId: payment.checkout_request_id,
      resultCode: 1032,
      resultDesc: 'Request cancelled by user (simulated)',
      rawPayload: { simulated: true, outcome },
    });
  }

  return settlePayment({
    checkoutRequestId: payment.checkout_request_id,
    resultCode: 0,
    resultDesc: 'The service request is processed successfully. (simulated)',
    receipt: receipt || `SIM${randomBytes(4).toString('hex').toUpperCase()}`,
    amount: payment.amount_kes,
    phone: payment.phone,
    rawPayload: { simulated: true, outcome },
  });
}

export async function cancelOrder({ orderId, user }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order) throw notFound('Order not found.');
    if (order.buyer_id !== user.id && user.role !== 'admin') {
      throw forbidden('This order belongs to another account.');
    }
    if (order.status === 'paid' || order.status === 'fulfilled') {
      throw conflict('Paid orders cannot be cancelled here — contact the atelier for a refund.');
    }
    if (order.status === 'cancelled') return getOrder(order.id, client);

    await client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
    await client.query(
      `UPDATE artworks a SET stock = a.stock + oi.quantity
         FROM order_items oi
        WHERE oi.order_id = $1 AND oi.artwork_id = a.id`,
      [order.id],
    );
    await client.query(
      `UPDATE payments SET status = 'failed', result_desc = 'Order cancelled'
        WHERE order_id = $1 AND status = 'initiated'`,
      [order.id],
    );
    return getOrder(order.id, client);
  });
}

export async function hasPurchased(artworkId, buyerId) {
  const { rows } = await query(
    `SELECT o.id, o.paid_at
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.artwork_id = $1 AND o.buyer_id = $2 AND o.status IN ${PAID_STATUSES}
      ORDER BY o.paid_at DESC NULLS LAST
      LIMIT 1`,
    [artworkId, buyerId],
  );
  return rows[0] ?? null;
}

export function requirePhone(value) {
  if (!value) throw badRequest('A mobile number is required for M-Pesa payment.');
  return normalizeKenyanPhone(value);
}
