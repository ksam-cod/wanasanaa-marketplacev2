import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { notFound, parse } from '../lib/http.js';
import { inquiryLimiter } from '../lib/limiters.js';

const router = Router();

const inquirySchema = z.object({
  artworkId: z.string().uuid().optional().nullable(),
  artistId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(2, 'Tell us your name.').max(120),
  email: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'),
  phone: z.string().trim().max(20).optional(),
  subject: z.string().trim().min(3, 'Add a short subject.').max(160),
  message: z.string().trim().min(10, 'Tell the studio a little more.').max(4000),
  budgetKes: z.coerce.number().int().min(1).max(100_000_000).optional(),
});

router.post('/inquiries', inquiryLimiter, async (req, res) => {
  const body = parse(inquirySchema, req.body);
  let artistId = body.artistId || null;

  if (body.artworkId) {
    const { rows } = await query('SELECT id, artist_id, status FROM artworks WHERE id = $1', [
      body.artworkId,
    ]);
    if (!rows.length || rows[0].status === 'archived') throw notFound('Artwork not found.');
    artistId = rows[0].artist_id;
  } else if (artistId) {
    const { rows } = await query('SELECT id FROM artists WHERE id = $1', [artistId]);
    if (!rows.length) throw notFound('Studio not found.');
  }

  const { rows } = await query(
    `INSERT INTO inquiries (artwork_id, artist_id, user_id, name, email, phone, subject, message, budget_kes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, status, created_at`,
    [
      body.artworkId || null,
      artistId,
      req.user?.id ?? null,
      body.name,
      body.email.toLowerCase(),
      body.phone || null,
      body.subject,
      body.message,
      body.budgetKes ?? null,
    ],
  );

  res.status(201).json({
    inquiry: rows[0],
    message: 'Your inquiry has been sent to the studio. They usually reply within two studio days.',
  });
});

export default router;
