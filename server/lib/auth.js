import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { forbidden, unauthorized } from './http.js';

const BCRYPT_ROUNDS = 12;

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    created_at: row.created_at,
  };
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.session.secure,
  path: '/',
});

/** Issues a JWT tied to a database session row, so it can be revoked on logout. */
export async function issueSession(res, user) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.session.days * 24 * 60 * 60 * 1000);

  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
    sessionId,
    user.id,
    expiresAt,
  ]);
  await query('DELETE FROM sessions WHERE expires_at < now()');

  const token = jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.id,
    jwtid: sessionId,
    expiresIn: `${config.session.days}d`,
    algorithm: 'HS256',
  });

  res.cookie(config.session.cookieName, token, {
    ...cookieOptions(),
    maxAge: config.session.days * 24 * 60 * 60 * 1000,
  });
}

export async function clearSession(res, sessionId) {
  if (sessionId) {
    await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }
  res.clearCookie(config.session.cookieName, cookieOptions());
}

/** Populates req.user from a live session (cookie, or Bearer token for API clients). */
export async function attachUser(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const token = req.cookies?.[config.session.cookieName] || bearer;
    if (!token) return next();

    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (!payload.jti) return next();

    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [payload.jti],
    );
    req.user = rows[0] ?? null;
    req.sessionId = rows[0] ? payload.jti : null;
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export async function getArtistForUser(userId) {
  const { rows } = await query('SELECT * FROM artists WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function requireArtist(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'artist') {
    return next(forbidden('This area is only available to artist accounts.'));
  }
  const artist = await getArtistForUser(req.user.id);
  if (!artist) return next(forbidden('No artist studio is linked to this account.'));
  req.artist = artist;
  next();
}
