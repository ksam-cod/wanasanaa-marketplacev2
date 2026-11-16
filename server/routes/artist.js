import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireArtist } from '../lib/auth.js';
import { forbidden, notFound, parse } from '../lib/http.js';
import { writeLimiter } from '../lib/limiters.js';
import { uploadArtworkImage } from '../lib/uploads.js';

const router = Router();
router.use(requireArtist);

const boolish = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
  }
  return Boolean(value);
}, z.boolean().optional());

const artworkFields = {
  title: z.string().trim().min(2, 'Give the piece a title.').max(160),
  description: z.string().trim().max(4000).optional(),
  medium: z.string().trim().max(160).optional(),
  category: z.string().trim().min(2).max(80),
  metal: z.string().trim().max(80).optional(),
  gemstone: z.string().trim().max(80).optional(),
  dimensions: z.string().trim().max(120).optional(),
  priceKes: z.coerce.number().int().min(1, 'Add a price in Kenya shillings.').max(100_000_000),
  stock: z.coerce.number().int().min(0, 'Stock cannot be negative.').max(9999),
  oneOfAKind: boolish,
  imageUrl: z
    .string()
    .trim()
    .max(600)
    .refine((value) => value === '' || /^\/uploads\/[\w.-]+$/.test(value) || /^https?:\/\//i.test(value), {
      message: 'Provide an https image URL or upload a file.',
    })
    .optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
};

const createSchema = z.object({
  ...artworkFields,
  category: artworkFields.category.default('Handcrafted Jewelry'),
  stock: artworkFields.stock.default(1),
  status: artworkFields.status.default('published'),
});

const patchSchema = z.object(artworkFields).partial();

function rawArtworkInput(body) {
  return {
    title: body.title,
    description: body.description,
    medium: body.medium,
    category: body.category,
    metal: body.metal,
    gemstone: body.gemstone,
    dimensions: body.dimensions,
    priceKes: body.price_kes ?? body.priceKes,
    stock: body.stock,
    oneOfAKind: body.one_of_a_kind ?? body.oneOfAKind,
    imageUrl: body.image_url ?? body.imageUrl,
    status: body.status,
  };
}

const artworkSelect = `
  a.id, a.artist_id, a.title, a.description, a.medium, a.category, a.metal,
  a.gemstone, a.dimensions, a.price_kes, a.stock, a.one_of_a_kind, a.image_url,
  a.status, a.is_featured, a.created_at, a.updated_at,
  COALESCE(s.units_sold, 0)::int AS units_sold,
  COALESCE(s.revenue_kes, 0)::int AS revenue_kes,
  COALESCE(r.review_count, 0)::int AS review_count,
  COALESCE(r.avg_rating, 0)::float AS avg_rating,
  COALESCE(i.inquiry_count, 0)::int AS inquiry_count
`;

const artworkJoins = `
  LEFT JOIN (
    SELECT oi.artwork_id, SUM(oi.quantity) AS units_sold, SUM(oi.line_total_kes) AS revenue_kes
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.artist_id = $1 AND o.status IN ('paid', 'fulfilled')
     GROUP BY oi.artwork_id
  ) s ON s.artwork_id = a.id
  LEFT JOIN (
    SELECT artwork_id, COUNT(*) AS review_count, AVG(rating) AS avg_rating
      FROM reviews GROUP BY artwork_id
  ) r ON r.artwork_id = a.id
  LEFT JOIN (
    SELECT artwork_id, COUNT(*) AS inquiry_count
      FROM inquiries WHERE artwork_id IS NOT NULL GROUP BY artwork_id
  ) i ON i.artwork_id = a.id
`;

router.get('/profile', (req, res) => {
  res.json({ artist: req.artist, user: req.user });
});

router.get('/summary', async (req, res) => {
  const artistId = req.artist.id;
  const [sales, ledger, awaiting, inventory, reviews, inquiries, recentSales, topArtworks, monthly] =
    await Promise.all([
      query(
        `SELECT COUNT(DISTINCT o.id)::int AS paid_orders,
                COALESCE(SUM(oi.quantity), 0)::int AS units_sold,
                COALESCE(SUM(oi.line_total_kes), 0)::int AS gross_sales_kes,
                COUNT(DISTINCT o.buyer_id)::int AS customers
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.artist_id = $1 AND o.status IN ('paid', 'fulfilled')`,
        [artistId],
      ),
      query(
        `SELECT COALESCE(SUM(net_kes), 0)::int AS total_net_kes,
                COALESCE(SUM(platform_fee_kes), 0)::int AS platform_fees_kes,
                COALESCE(SUM(CASE WHEN status = 'available' THEN net_kes ELSE 0 END), 0)::int AS available_kes,
                COUNT(*)::int AS sold_lines
           FROM earnings WHERE artist_id = $1`,
        [artistId],
      ),
      query(
        `SELECT COALESCE(SUM(oi.line_total_kes - ROUND(oi.line_total_kes * oi.commission_rate)::int), 0)::int AS awaiting_kes,
                COUNT(DISTINCT o.id)::int AS orders
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.artist_id = $1 AND o.status = 'pending_payment'`,
        [artistId],
      ),
      query(
        `SELECT COUNT(*)::int AS artworks,
                COUNT(*) FILTER (WHERE status = 'published')::int AS published,
                COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
                COALESCE(SUM(stock) FILTER (WHERE status = 'published'), 0)::int AS units_in_stock,
                COUNT(*) FILTER (WHERE status = 'published' AND stock = 0)::int AS out_of_stock,
                COUNT(*) FILTER (WHERE status = 'published' AND stock BETWEEN 1 AND 2)::int AS low_stock
           FROM artworks WHERE artist_id = $1 AND status <> 'archived'`,
        [artistId],
      ),
      query(
        `SELECT COUNT(*)::int AS review_count,
                COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0)::float AS average_rating
           FROM reviews r JOIN artworks a ON a.id = r.artwork_id
          WHERE a.artist_id = $1`,
        [artistId],
      ),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'new')::int AS new
           FROM inquiries WHERE artist_id = $1`,
        [artistId],
      ),
      query(
        `SELECT oi.id, oi.title, oi.quantity, oi.line_total_kes, o.order_number, o.paid_at,
                (oi.line_total_kes - ROUND(oi.line_total_kes * oi.commission_rate)::int)::int AS net_kes,
                u.name AS buyer_name, a.image_url
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN users u ON u.id = o.buyer_id
           LEFT JOIN artworks a ON a.id = oi.artwork_id
          WHERE oi.artist_id = $1 AND o.status IN ('paid', 'fulfilled')
          ORDER BY o.paid_at DESC NULLS LAST
          LIMIT 8`,
        [artistId],
      ),
      query(
        `SELECT a.id, a.title, a.image_url, s.units_sold, s.gross_kes
           FROM artworks a
           JOIN (
             SELECT oi.artwork_id, SUM(oi.quantity)::int AS units_sold, SUM(oi.line_total_kes)::int AS gross_kes
               FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.artist_id = $1 AND o.status IN ('paid', 'fulfilled')
              GROUP BY oi.artwork_id
           ) s ON s.artwork_id = a.id
          ORDER BY s.units_sold DESC, s.gross_kes DESC
          LIMIT 5`,
        [artistId],
      ),
      query(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
                SUM(net_kes)::int AS net_kes, COUNT(*)::int AS sales
           FROM earnings WHERE artist_id = $1
          GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
        [artistId],
      ),
    ]);

  res.json({
    currency: 'KES',
    artist: {
      id: req.artist.id,
      studio_name: req.artist.studio_name,
      location: req.artist.location,
      verified: req.artist.verified,
      commission_rate: Number(req.artist.commission_rate),
    },
    earnings: {
      ...ledger.rows[0],
      awaiting_payment_kes: awaiting.rows[0].awaiting_kes,
      awaiting_payment_orders: awaiting.rows[0].orders,
    },
    sales: sales.rows[0],
    inventory: inventory.rows[0],
    reviews: reviews.rows[0],
    inquiries: inquiries.rows[0],
    recent_sales: recentSales.rows,
    top_artworks: topArtworks.rows,
    monthly_earnings: monthly.rows,
  });
});

router.get('/artworks', async (req, res) => {
  const includeArchived = /^(1|true)$/i.test(String(req.query.include_archived ?? ''));
  const params = [req.artist.id];
  let archivedFilter = "AND a.status <> 'archived'";
  if (includeArchived) archivedFilter = '';

  const { rows } = await query(
    `SELECT ${artworkSelect}
       FROM artworks a
       ${artworkJoins}
      WHERE a.artist_id = $1 ${archivedFilter}
      ORDER BY a.created_at DESC`,
    params,
  );
  res.json({ artworks: rows });
});

router.post('/artworks', writeLimiter, uploadArtworkImage, async (req, res) => {
  try {
    const body = parse(createSchema, rawArtworkInput(req.body));
    if (!body.imageUrl && req.file) body.imageUrl = `/uploads/${req.file.filename}`;

    const { rows } = await query(
      `INSERT INTO artworks
         (artist_id, title, description, medium, category, metal, gemstone, dimensions,
          price_kes, stock, one_of_a_kind, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.artist.id,
        body.title,
        body.description || null,
        body.medium || null,
        body.category,
        body.metal || null,
        body.gemstone || null,
        body.dimensions || null,
        body.priceKes,
        body.stock,
        body.oneOfAKind ?? body.stock === 1,
        body.imageUrl || null,
        body.status,
      ],
    );

    res.status(201).json({ artwork: { ...rows[0], units_sold: 0, revenue_kes: 0 } });
  } catch (error) {
    if (req.file) {
      await fs.unlink(path.join(config.uploadsDir, req.file.filename)).catch(() => {});
    }
    throw error;
  }
});

router.patch('/artworks/:id', writeLimiter, async (req, res) => {
  const body = parse(patchSchema, rawArtworkInput(req.body));
  const { rows: existingRows } = await query(
    'SELECT * FROM artworks WHERE id = $1 AND artist_id = $2',
    [req.params.id, req.artist.id],
  );
  const existing = existingRows[0];
  if (!existing) throw notFound('Artwork not found in your studio.');

  const next = {
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    medium: body.medium ?? existing.medium,
    category: body.category ?? existing.category,
    metal: body.metal ?? existing.metal,
    gemstone: body.gemstone ?? existing.gemstone,
    dimensions: body.dimensions ?? existing.dimensions,
    priceKes: body.priceKes ?? existing.price_kes,
    stock: body.stock ?? existing.stock,
    oneOfAKind: body.oneOfAKind ?? existing.one_of_a_kind,
    imageUrl: body.imageUrl ?? existing.image_url,
    status: body.status ?? existing.status,
  };

  const { rows } = await query(
    `UPDATE artworks
        SET title = $3, description = $4, medium = $5, category = $6, metal = $7,
            gemstone = $8, dimensions = $9, price_kes = $10, stock = $11,
            one_of_a_kind = $12, image_url = $13, status = $14
      WHERE id = $1 AND artist_id = $2
      RETURNING *`,
    [
      existing.id,
      req.artist.id,
      next.title,
      next.description,
      next.medium,
      next.category,
      next.metal,
      next.gemstone,
      next.dimensions,
      next.priceKes,
      next.stock,
      next.oneOfAKind,
      next.imageUrl,
      next.status,
    ],
  );

  res.json({ artwork: rows[0] });
});

router.delete('/artworks/:id', writeLimiter, async (req, res) => {
  const { rows } = await query(
    `UPDATE artworks SET status = 'archived'
      WHERE id = $1 AND artist_id = $2
      RETURNING id, status`,
    [req.params.id, req.artist.id],
  );
  if (!rows.length) throw notFound('Artwork not found in your studio.');
  res.json({ artwork: rows[0] });
});

router.get('/earnings', async (req, res) => {
  const [ledger, totals, monthly] = await Promise.all([
    query(
      `SELECT e.id, e.order_id, e.artwork_id, e.gross_kes, e.platform_fee_kes, e.net_kes,
              e.status, e.currency, e.created_at,
              a.title AS artwork_title, a.image_url,
              o.order_number, u.name AS buyer_name
         FROM earnings e
         JOIN artworks a ON a.id = e.artwork_id
         JOIN orders o ON o.id = e.order_id
         JOIN users u ON u.id = o.buyer_id
        WHERE e.artist_id = $1
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [req.artist.id],
    ),
    query(
      `SELECT COALESCE(SUM(gross_kes), 0)::int AS gross_kes,
              COALESCE(SUM(platform_fee_kes), 0)::int AS platform_fees_kes,
              COALESCE(SUM(net_kes), 0)::int AS net_kes
         FROM earnings WHERE artist_id = $1`,
      [req.artist.id],
    ),
    query(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
              SUM(net_kes)::int AS net_kes, COUNT(*)::int AS sales
         FROM earnings WHERE artist_id = $1
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      [req.artist.id],
    ),
  ]);

  res.json({
    currency: 'KES',
    commission_rate: Number(req.artist.commission_rate),
    totals: totals.rows[0],
    monthly: monthly.rows,
    earnings: ledger.rows,
  });
});

router.get('/orders', async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.status, o.created_at, o.paid_at,
            o.shipping_name, o.shipping_city, o.shipping_phone,
            json_agg(json_build_object(
              'title', oi.title,
              'quantity', oi.quantity,
              'unit_price_kes', oi.unit_price_kes,
              'line_total_kes', oi.line_total_kes,
              'net_kes', (oi.line_total_kes - ROUND(oi.line_total_kes * oi.commission_rate)::int)
            ) ORDER BY oi.created_at) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE oi.artist_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100`,
    [req.artist.id],
  );
  res.json({ orders: rows });
});

router.get('/customers', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.phone,
            COUNT(DISTINCT o.id)::int AS orders,
            SUM(oi.quantity)::int AS pieces,
            SUM(oi.line_total_kes)::int AS spend_kes,
            MAX(o.paid_at) AS last_order_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.buyer_id
      WHERE oi.artist_id = $1 AND o.status IN ('paid', 'fulfilled')
      GROUP BY u.id
      ORDER BY spend_kes DESC`,
    [req.artist.id],
  );
  res.json({ customers: rows });
});

router.get('/inquiries', async (req, res) => {
  const status = ['new', 'replied', 'closed'].includes(String(req.query.status))
    ? String(req.query.status)
    : null;
  const params = [req.artist.id];
  let filter = '';
  if (status) {
    params.push(status);
    filter = `AND q.status = $2`;
  }

  const { rows } = await query(
    `SELECT q.id, q.name, q.email, q.phone, q.subject, q.message, q.budget_kes,
            q.status, q.created_at, a.id AS artwork_id, a.title AS artwork_title, a.image_url
       FROM inquiries q
       LEFT JOIN artworks a ON a.id = q.artwork_id
      WHERE q.artist_id = $1 ${filter}
      ORDER BY q.created_at DESC
      LIMIT 200`,
    params,
  );
  res.json({ inquiries: rows });
});

router.patch('/inquiries/:id', writeLimiter, async (req, res) => {
  const body = parse(z.object({ status: z.enum(['new', 'replied', 'closed']) }), req.body);
  const { rows } = await query(
    `UPDATE inquiries SET status = $3
      WHERE id = $1 AND artist_id = $2
      RETURNING id, status`,
    [req.params.id, req.artist.id, body.status],
  );
  if (!rows.length) throw notFound('Inquiry not found.');
  res.json({ inquiry: rows[0] });
});

router.get('/orders/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT o.*, u.name AS buyer_name, u.email AS buyer_email
       FROM orders o JOIN users u ON u.id = o.buyer_id
      WHERE o.id = $1 AND EXISTS (
        SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.artist_id = $2
      )`,
    [req.params.id, req.artist.id],
  );
  if (!rows.length) throw forbidden('This order does not include your work.');

  const items = await query(
    `SELECT id, title, quantity, unit_price_kes, line_total_kes,
            (line_total_kes - ROUND(line_total_kes * commission_rate)::int)::int AS net_kes
       FROM order_items WHERE order_id = $1 AND artist_id = $2`,
    [req.params.id, req.artist.id],
  );
  res.json({ order: { ...rows[0], items: items.rows } });
});

export default router;
