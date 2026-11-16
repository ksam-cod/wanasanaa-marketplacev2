import rateLimit from 'express-rate-limit';

const json = (code, message) => (req, res) => {
  res.status(429).json({ error: { code, message } });
};

const base = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: json('rate_limited', 'Too many attempts. Please wait a moment and try again.'),
};

export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 25 });
export const paymentLimiter = rateLimit({ ...base, windowMs: 10 * 60 * 1000, limit: 20 });
export const inquiryLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 15 });
export const writeLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 120 });
