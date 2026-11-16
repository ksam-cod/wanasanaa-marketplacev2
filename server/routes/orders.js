import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { forbidden, normalizeKenyanPhone, notFound, parse } from '../lib/http.js';
import { paymentLimiter } from '../lib/limiters.js';
import { query } from '../db.js';
import {
  cancelOrder,
  createOrder,
  getOrder,
  initiatePayment,
  listOrdersForBuyer,
  simulatePaymentResult,
} from '../services/orders.js';

const router = Router();
// Scoped to /orders so this router's guard cannot intercept public routes
// (inquiries, the M-Pesa callback) that are mounted on the same /api prefix.
router.use('/orders', requireAuth);

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        artworkId: z.string().uuid('Unknown artwork.'),
        quantity: z.coerce.number().int().min(1).max(10).default(1),
      }),
    )
    .min(1, 'Your selection is empty.')
    .max(10),
  shipping: z.object({
    name: z.string().trim().min(2, 'Enter the recipient name.').max(120),
    phone: z.string().trim().min(9, 'Enter a delivery phone number.').max(20),
    address: z.string().trim().min(6, 'Enter the delivery address.').max(300),
    city: z.string().trim().min(2, 'Enter the delivery town or city.').max(120),
  }),
  phone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

router.post('/orders', paymentLimiter, async (req, res) => {
  const body = parse(checkoutSchema, req.body);
  const mpesaPhone = normalizeKenyanPhone(body.phone || body.shipping.phone);

  const order = await createOrder({
    user: req.user,
    items: body.items,
    shipping: { ...body.shipping, phone: normalizeKenyanPhone(body.shipping.phone) },
    notes: body.notes,
  });

  // The order (and its stock reservation) survives a failed STK Push, so the
  // customer can retry from the order screen instead of losing the cart.
  try {
    const payment = await initiatePayment({ orderId: order.id, user: req.user, phone: mpesaPhone });
    res.status(201).json({ order: await getOrder(order.id), payment: payment.payment, simulated: payment.simulated });
  } catch (error) {
    res.status(201).json({
      order: await getOrder(order.id),
      payment: null,
      paymentError: error.message || 'Could not start the M-Pesa prompt.',
    });
  }
});

router.get('/orders', async (req, res) => {
  const orders = await listOrdersForBuyer(req.user.id);
  res.json({ orders });
});

router.get('/orders/:id', async (req, res) => {
  const { rows } = await query('SELECT buyer_id FROM orders WHERE id = $1', [req.params.id]);
  if (!rows.length) throw notFound('Order not found.');
  if (rows[0].buyer_id !== req.user.id && req.user.role !== 'admin') {
    throw forbidden('This order belongs to another account.');
  }
  res.set('Cache-Control', 'no-store');
  res.json({ order: await getOrder(req.params.id) });
});

router.post('/orders/:id/pay', paymentLimiter, async (req, res) => {
  const body = parse(z.object({ phone: z.string().trim().min(9).max(20) }), req.body);
  const result = await initiatePayment({ orderId: req.params.id, user: req.user, phone: body.phone });
  res.json({ order: await getOrder(req.params.id), payment: result.payment, simulated: result.simulated });
});

router.post('/orders/:id/cancel', async (req, res) => {
  const order = await cancelOrder({ orderId: req.params.id, user: req.user });
  res.json({ order });
});

const simulateSchema = z.object({
  outcome: z.enum(['success', 'failed']).default('success'),
});

router.post('/orders/:id/simulate-payment', paymentLimiter, async (req, res) => {
  const body = parse(simulateSchema, req.body);
  const result = await simulatePaymentResult({
    orderId: req.params.id,
    user: req.user,
    outcome: body.outcome,
  });
  res.json({ result, order: await getOrder(req.params.id) });
});

export default router;
