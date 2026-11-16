import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const int = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const isProduction = process.env.NODE_ENV === 'production';
const mpesa = {
  env: trimmed(process.env.MPESA_ENV) || 'sandbox',
  baseUrl: trimmed(process.env.MPESA_BASE_URL),
  consumerKey: trimmed(process.env.MPESA_CONSUMER_KEY),
  consumerSecret: trimmed(process.env.MPESA_CONSUMER_SECRET),
  shortcode: trimmed(process.env.MPESA_SHORTCODE),
  passkey: trimmed(process.env.MPESA_PASSKEY),
  transactionType: trimmed(process.env.MPESA_TRANSACTION_TYPE) || 'CustomerPayBillOnline',
  callbackUrl: trimmed(process.env.MPESA_CALLBACK_URL),
};
mpesa.baseUrl =
  mpesa.baseUrl ||
  (mpesa.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

const hasCredentials = Boolean(
  mpesa.consumerKey && mpesa.consumerSecret && mpesa.shortcode && mpesa.passkey,
);
const simulate =
  /^(1|true|yes)$/i.test(trimmed(process.env.MPESA_SIMULATE)) || !hasCredentials;

if (isProduction && !hasCredentials) {
  throw new Error(
    'M-Pesa Daraja credentials are required in production (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY).',
  );
}
if (isProduction && !trimmed(process.env.MPESA_CALLBACK_URL)) {
  throw new Error('MPESA_CALLBACK_URL must be a public HTTPS URL in production.');
}
if (isProduction && simulate) {
  throw new Error('MPESA_SIMULATE cannot be enabled in production.');
}

// Some shells export PORT=0 to mean "any free port"; that would leave the
// advertised origin wrong, so only accept a real, usable port number.
const envPort = int(process.env.PORT, 4000);
const port = envPort > 0 && envPort < 65_536 ? envPort : 4000;

const appUrl = (trimmed(process.env.APP_URL) || `http://localhost:${port}`).replace(/\/$/, '');

export const config = {
  root,
  isProduction,
  port,
  appUrl,
  databaseUrl:
    trimmed(process.env.DATABASE_URL) || 'postgres://postgres@127.0.0.1:5433/wanasanaa',
  databaseSsl: /^(1|true|yes|require)$/i.test(trimmed(process.env.DATABASE_SSL)),
  jwtSecret:
    trimmed(process.env.JWT_SECRET) ||
    (isProduction ? '' : 'dev-only-secret-please-generate-a-32-byte-random-value'),
  session: {
    cookieName: 'wanasanaa_session',
    days: 7,
    secure: isProduction,
  },
  platform: {
    currency: 'KES',
    commissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.12),
    shippingKes: Math.max(0, int(process.env.SHIPPING_FEE_KES, 0)),
    name: 'Wanasanaa Contemporary',
  },
  mpesa: {
    ...mpesa,
    simulate,
    callbackUrl: mpesa.callbackUrl || `${appUrl}/api/webhooks/mpesa/callback`,
    timeoutMs: 20_000,
  },
  uploadsDir: path.join(root, 'uploads'),
  publicDir: path.join(root, 'public'),
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is required in production.');
}
