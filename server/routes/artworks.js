import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { conflict, notFound, parse } from '../lib/http.js';
import { writeLimiter } from '../lib/limiters.js';
import { hasPurchased } from '../services/orders.js';

const router = Router();

const artworkCard = `
  a.id, a.title, a.description, a.medium, a.category, a.metal, a.gemstone,
  a.dimensions, a.price_kes, a.stock, a.one_of_a_kind, a.image_url,
  a.is_featured, a.created_at,
  ar.id AS artist_id, ar.studio_name, ar.location AS artist_location, ar.verified,
  COALESCE(rv.avg_rating, 0)::float AS avg_rating,
  COALESCE(rv.review_count, 0)::int AS review_count
`;

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  metal: z.string().trim().max(80).optional(),
  gemstone: z.string().trim().max(80).optional(),
  artist: z.string().uuid().optional(),
  sort: z.enum(['curated', 'newest', 'price_asc', 'price_desc', 'rating']).default('curated'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

router.get('/artworks', async (req, res) => {
  const filters = parse(listQuery, req.query);
  const values = [];
  const conditions = ["a.status = 'published'", 'a.stock > 0'];

  if (filters.q) {
    values.push(`%${filters.q}%`);
    conditions.push(
      `(a.title ILIKE $${values.length} OR a.description ILIKE $${values.length} OR a.medium ILIKE $${values.length} OR ar.studio_name ILIKE $${values.length})`,
    );
  }
  if (filters.category) {
    values.push(filters.category);
    conditions.push(`a.category = $${values.length}`);
  }
  if (filters.metal) {
    values.push(filters.metal);
    conditions.push(`a.metal = $${values.length}`);
  }
  if (filters.gemstone) {
    values.push(filters.gemstone);
    conditions.push(`a.gemstone = $${values.length}`);
  }
  if (filters.artist) {
    values.push(filters.artist);
    conditions.push(`a.artist_id = $${values.length}`);
  }

  const where = conditions.join(' AND ');
  const orderBy = {
    curated: 'a.is_featured DESC, a.created_at DESC',
    newest: 'a.created_at DESC',
    price_asc: 'a.price_kes ASC',
    price_desc: 'a.price_kes DESC',
    rating: 'avg_rating DESC, a.created_at DESC',
  }[filters.sort];

  const offset = (filters.page - 1) * filters.limit;
  values.push(filters.limit, offset);

  const [list, count] = await Promise.all([
    query(
      `SELECT ${artworkCard}
         FROM artworks a
         JOIN artists ar ON ar.id = a.artist_id
         LEFT JOIN (
           SELECT artwork_id, AVG(rating) AS avg_rating, COUNT(*)::int AS review_count
             FROM reviews GROUP BY artwork_id
         ) rv ON rv.artwork_id = a.id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    ),
    query(
      `SELECT COUNT(*)::int AS total
         FROM artworks a JOIN artists ar ON ar.id = a.artist_id
        WHERE ${where}`,
      values.slice(0, -2),
    ),
  ]);

  res.json({
    artworks: list.rows,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: count.rows[0].total,
      pages: Math.max(1, Math.ceil(count.rows[0].total / filters.limit)),
    },
  });
});

router.get('/artworks/featured', async (_req, res) => {
  const { rows } = await query(
    `SELECT ${artworkCard}
       FROM artworks a
       JOIN artists ar ON ar.id = a.artist_id
       LEFT JOIN (
         SELECT artwork_id, AVG(rating) AS avg_rating, COUNT(*)::int AS review_count
           FROM reviews GROUP BY artwork_id
       ) rv ON rv.artwork_id = a.id
      WHERE a.status = 'published' AND a.stock > 0
      ORDER BY a.is_featured DESC, a.price_kes DESC
      LIMIT 1`,
  );
  res.json({ artwork: rows[0] ?? null });
});

router.get('/artworks/facets', async (_req, res) => {
  const [categories, metals, gemstones] = await Promise.all([
    query(
      `SELECT category AS value, COUNT(*)::int AS count FROM artworks
        WHERE status = 'published' AND stock > 0 GROUP BY 1 ORDER BY count DESC LIMIT 12`,
    ),
    query(
      `SELECT metal AS value, COUNT(*)::int AS count FROM artworks
        WHERE status = 'published' AND stock > 0 AND metal IS NOT NULL GROUP BY 1 ORDER BY count DESC LIMIT 12`,
    ),
    query(
      `SELECT gemstone AS value, COUNT(*)::int AS count FROM artworks
        WHERE status = 'published' AND stock > 0 AND gemstone IS NOT NULL GROUP BY 1 ORDER BY count DESC LIMIT 12`,
    ),
  ]);
  res.json({ categories: categories.rows, metals: metals.rows, gemstones: gemstones.rows });
});

router.get('/artworks/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${artworkCard}, ar.bio AS artist_bio, ar.discipline AS artist_discipline
       FROM artworks a
       JOIN artists ar ON ar.id = a.artist_id
       LEFT JOIN (
         SELECT artwork_id, AVG(rating) AS avg_rating, COUNT(*)::int AS review_count
           FROM reviews GROUP BY artwork_id
       ) rv ON rv.artwork_id = a.id
      WHERE a.id = $1 AND a.status = 'published'`,
    [req.params.id],
  );
  const artwork = rows[0];
  if (!artwork) throw notFound('Artwork not found.');

  const reviews = await query(
    `SELECT r.id, r.rating, r.title, r.body, r.created_at,
            split_part(u.name, ' ', 1) AS reviewer
       FROM reviews r JOIN users u ON u.id = r.buyer_id
      WHERE r.artwork_id = $1
      ORDER BY r.created_at DESC`,
    [artwork.id],
  );

  let canReview = false;
  let myReview = null;
  if (req.user) {
    const purchase = await hasPurchased(artwork.id, req.user.id);
    const mine = await query(
      'SELECT id, rating, title, body, created_at FROM reviews WHERE artwork_id = $1 AND buyer_id = $2',
      [artwork.id, req.user.id],
    );
    myReview = mine.rows[0] ?? null;
    canReview = Boolean(purchase) && !myReview;
  }

  res.json({ artwork, reviews: reviews.rows, canReview, myReview, signedIn: Boolean(req.user) });
});

router.get('/artworks/:id/reviews', async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.rating, r.title, r.body, r.created_at, split_part(u.name, ' ', 1) AS reviewer
       FROM reviews r
       JOIN users u ON u.id = r.buyer_id
      WHERE r.artwork_id = $1
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [req.params.id],
  );
  res.json({ reviews: rows });
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, 'Share at least a sentence about the piece.').max(2000),
});

router.post('/artworks/:id/reviews', requireAuth, writeLimiter, async (req, res) => {
  const artworkId = req.params.id;
  const body = parse(reviewSchema, req.body);

  const artwork = await query("SELECT id FROM artworks WHERE id = $1 AND status <> 'archived'", [artworkId]);
  if (!artwork.rows.length) throw notFound('Artwork not found.');

  const purchase = await hasPurchased(artworkId, req.user.id);
  if (!purchase) {
    throw conflict('Only collectors who have purchased this piece can review it.', 'purchase_required');
  }

  const existing = await query('SELECT 1 FROM reviews WHERE artwork_id = $1 AND buyer_id = $2', [
    artworkId,
    req.user.id,
  ]);
  if (existing.rows.length) throw conflict('You have already reviewed this piece.', 'already_reviewed');

  const { rows } = await query(
    `INSERT INTO reviews (artwork_id, buyer_id, order_id, rating, title, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, rating, title, body, created_at`,
    [artworkId, req.user.id, purchase.id, body.rating, body.title || null, body.body],
  );

  res.status(201).json({ review: { ...rows[0], reviewer: req.user.name.split(' ')[0] } });
});

router.get('/artists', async (_req, res) => {
  const { rows } = await query(
    `SELECT ar.id, ar.studio_name, ar.location, ar.discipline, ar.bio, ar.verified,
            COUNT(a.id) FILTER (WHERE a.status = 'published' AND a.stock > 0)::int AS pieces
       FROM artists ar
       LEFT JOIN artworks a ON a.artist_id = ar.id
      GROUP BY ar.id
      ORDER BY pieces DESC, ar.studio_name`,
  );
  res.json({ artists: rows });
});

router.get('/artists/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT id, studio_name, location, discipline, bio, verified
       FROM artists WHERE id = $1`,
    [req.params.id],
  );
  if (!rows.length) throw notFound('Studio not found.');

  const works = await query(
    `SELECT ${artworkCard}
       FROM artworks a
       JOIN artists ar ON ar.id = a.artist_id
       LEFT JOIN (
         SELECT artwork_id, AVG(rating) AS avg_rating, COUNT(*)::int AS review_count
           FROM reviews GROUP BY artwork_id
       ) rv ON rv.artwork_id = a.id
      WHERE a.artist_id = $1 AND a.status = 'published' AND a.stock > 0
      ORDER BY a.created_at DESC`,
    [req.params.id],
  );

  res.json({ artist: rows[0], artworks: works.rows });
});

export default router;
