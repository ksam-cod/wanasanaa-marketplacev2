import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { clearSession, hashPassword, issueSession, publicUser, verifyPassword } from '../lib/auth.js';
import { conflict, parse, unauthorized } from '../lib/http.js';
import { authLimiter } from '../lib/limiters.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailField = z
  .string()
  .trim()
  .max(254)
  .regex(emailPattern, 'Enter a valid email address.');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name.').max(80),
  email: emailField,
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  role: z.enum(['collector', 'artist']).default('collector'),
  phone: z.string().trim().max(20).optional(),
  studioName: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  discipline: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(1000).optional(),
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password.').max(200),
});

router.post('/register', authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  const email = body.email.toLowerCase();
  const phone = body.phone?.replace(/\s+/g, '') || null;

  const existing = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (existing.rows.length) {
    throw conflict('An account with that email already exists.', 'email_in_use');
  }

  const passwordHash = await hashPassword(body.password);

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, phone, created_at`,
      [body.name, email, passwordHash, body.role, phone],
    );
    const created = rows[0];

    if (body.role === 'artist') {
      await client.query(
        `INSERT INTO artists (user_id, studio_name, location, bio, discipline)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          created.id,
          body.studioName || `${body.name} Studio`,
          body.location || null,
          body.bio || null,
          body.discipline || null,
        ],
      );
    }
    return created;
  });

  await issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  const { rows } = await query(
    `SELECT id, name, email, role, phone, password_hash, created_at
       FROM users WHERE lower(email) = $1`,
    [body.email.toLowerCase()],
  );
  const account = rows[0];
  const valid = account ? await verifyPassword(body.password, account.password_hash) : false;

  if (!account || !valid) {
    throw unauthorized('Email or password is incorrect.');
  }

  await issueSession(res, account);
  res.json({ user: publicUser(account) });
});

router.post('/logout', async (req, res) => {
  await clearSession(res, req.sessionId);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  let artist = null;
  if (req.user.role === 'artist') {
    const { rows } = await query(
      'SELECT id, studio_name, location, bio, discipline, verified, commission_rate FROM artists WHERE user_id = $1',
      [req.user.id],
    );
    artist = rows[0] ?? null;
  }
  res.set('Cache-Control', 'no-store');
  res.json({ user: publicUser(req.user), artist });
});

export default router;
