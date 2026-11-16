-- Wanasanaa Contemporary — marketplace schema (PostgreSQL 14+)
-- Money is stored as whole Kenyan shillings (integer), matching M-Pesa's KES-only amounts.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'collector' CHECK (role IN ('collector', 'artist', 'admin')),
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- Server-side sessions so signing out (or an admin revoking a session) is immediate.
CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS artists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  studio_name     text NOT NULL,
  location        text,
  bio             text,
  discipline      text,
  verified        boolean NOT NULL DEFAULT false,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0.1200 CHECK (commission_rate >= 0 AND commission_rate <= 0.5),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artworks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  medium       text,
  category     text NOT NULL DEFAULT 'Handcrafted Jewelry',
  metal        text,
  gemstone     text,
  dimensions   text,
  price_kes    integer NOT NULL CHECK (price_kes > 0),
  stock        integer NOT NULL DEFAULT 1 CHECK (stock >= 0),
  one_of_a_kind boolean NOT NULL DEFAULT false,
  image_url    text,
  status       text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  is_featured  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artworks_artist_idx ON artworks (artist_id);
CREATE INDEX IF NOT EXISTS artworks_public_idx ON artworks (status, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   text NOT NULL UNIQUE,
  buyer_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'pending_payment'
                 CHECK (status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  currency       char(3) NOT NULL DEFAULT 'KES',
  subtotal_kes   integer NOT NULL CHECK (subtotal_kes >= 0),
  shipping_kes   integer NOT NULL DEFAULT 0 CHECK (shipping_kes >= 0),
  total_kes      integer NOT NULL CHECK (total_kes >= 0),
  shipping_name  text NOT NULL,
  shipping_phone text NOT NULL,
  shipping_address text NOT NULL,
  shipping_city  text NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artwork_id      uuid NOT NULL REFERENCES artworks(id) ON DELETE RESTRICT,
  artist_id       uuid NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
  title           text NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit_price_kes  integer NOT NULL CHECK (unit_price_kes > 0),
  line_total_kes  integer NOT NULL CHECK (line_total_kes > 0),
  commission_rate numeric(5,4) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_artist_idx ON order_items (artist_id);
CREATE INDEX IF NOT EXISTS order_items_artwork_idx ON order_items (artwork_id);

CREATE TABLE IF NOT EXISTS payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'mpesa',
  phone               text NOT NULL,
  amount_kes          integer NOT NULL CHECK (amount_kes > 0),
  status              text NOT NULL DEFAULT 'initiated'
                      CHECK (status IN ('initiated', 'succeeded', 'failed')),
  simulated           boolean NOT NULL DEFAULT false,
  merchant_request_id text,
  checkout_request_id text UNIQUE,
  mpesa_receipt       text UNIQUE,
  result_code         integer,
  result_desc         text,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

-- One ledger row per sold line item; the artist's net is the sale minus the platform commission.
CREATE TABLE IF NOT EXISTS earnings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id    uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artwork_id       uuid NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  artist_id        uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  currency         char(3) NOT NULL DEFAULT 'KES',
  gross_kes        integer NOT NULL,
  platform_fee_kes integer NOT NULL,
  net_kes          integer NOT NULL,
  status           text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'paid')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS earnings_artist_idx ON earnings (artist_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id uuid NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  buyer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title      text,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artwork_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS reviews_artwork_idx ON reviews (artwork_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inquiries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id uuid REFERENCES artworks(id) ON DELETE SET NULL,
  artist_id  uuid REFERENCES artists(id) ON DELETE SET NULL,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL,
  email      text NOT NULL,
  phone      text,
  subject    text NOT NULL,
  message    text NOT NULL,
  budget_kes integer CHECK (budget_kes IS NULL OR budget_kes > 0),
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_artist_idx ON inquiries (artist_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artworks_set_updated_at ON artworks;
CREATE TRIGGER artworks_set_updated_at BEFORE UPDATE ON artworks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
