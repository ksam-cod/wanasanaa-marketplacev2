import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { query } from './db.js';
import { attachUser } from './lib/auth.js';
import { ApiError, errorHandler, notFoundHandler } from './lib/http.js';
import authRoutes from './routes/auth.js';
import artworkRoutes from './routes/artworks.js';
import orderRoutes from './routes/orders.js';
import inquiryRoutes from './routes/inquiries.js';
import artistRoutes from './routes/artist.js';
import paymentRoutes from './routes/payments.js';

/** Rejects cross-site state-changing requests (defence in depth alongside SameSite cookies). */
function sameOriginOnly(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();

  const allowed = new Set([config.appUrl, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin.replace(/\/$/, ''))) {
    return next(new ApiError(403, 'bad_origin', 'Cross-site requests are not allowed.'));
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(cookieParser());

  // Static assets are served before the session lookup so CSS/images never hit the database.
  app.use(express.static(config.publicDir, { index: 'index.html', maxAge: 0 }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d', immutable: true }));

  app.use(sameOriginOnly);
  app.use(attachUser);

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      platform: config.platform,
      payments: {
        provider: 'mpesa',
        environment: config.mpesa.env,
        simulate: config.mpesa.simulate,
        instructions: config.mpesa.simulate
          ? 'Simulation mode: no Daraja credentials configured, payments complete without a real PIN prompt.'
          : 'An M-Pesa prompt is sent to the phone number at checkout.',
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/artist', artistRoutes);
  app.use('/api', artworkRoutes);
  app.use('/api', orderRoutes);
  app.use('/api', inquiryRoutes);
  app.use('/api/webhooks', paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const pages = {
  home: path.join(config.publicDir, 'index.html'),
};
