import { Router } from 'express';
import { handleMpesaCallback } from '../services/orders.js';

const router = Router();

/**
 * Safaricom POSTs STK Push results here. Always ACK with ResultCode 0, even for
 * unknown or duplicate callbacks, so Daraja does not keep retrying.
 */
router.post('/mpesa/callback', async (req, res) => {
  const result = await handleMpesaCallback(req.body);
  if (result.settled) console.info('[mpesa] payment settled for order', result.orderId);
  if (result.failed) console.warn('[mpesa] payment failed', result);
  if (result.refundRequired) console.warn('[mpesa] payment received for a cancelled order — refund required');
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/** Daraja validation/preflight ping (some setups point here first). */
router.get('/mpesa/callback', (_req, res) => {
  res.json({ ok: true, provider: 'mpesa' });
});

export default router;
