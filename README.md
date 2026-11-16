# Wanasanaa Contemporary — marketplace API & gallery

A full marketplace for handcrafted jewellery and wearable sculpture: a PostgreSQL-backed
Express API serving the editorial gallery in `public/`, plus a studio dashboard where artists
add pieces, set price tags in **Kenyan shillings**, track inventory, sales, collectors and
earnings, and take payment through **Safaricom M-Pesa (Daraja STK Push)**.

Everything displayed to a customer is priced in KES. Money is stored as whole shillings
(integers) because M-Pesa only accepts whole-shilling amounts.

```
public/                    storefront + studio dashboard (vanilla HTML/CSS/JS, no build step)
  index.html               gallery, filters, spotlight, commission inquiry
  artwork.html             piece detail, reviews (verified buyers), inquiry form
  checkout.html            basket, delivery details, M-Pesa payment state
  login.html               collector / studio sign-in and registration
  dashboard.html           artist dashboard
  css/app.css              design system (Newsreader + Plus Jakarta Sans)
  js/                      page modules and shared API client
server/                    Express 5 API
  index.js, app.js         boot, security headers, static hosting, routes
  config.js                environment configuration
  db.js                    pg pool + transaction helper
  lib/                     auth/sessions, validation, uploads, rate limits
  routes/                  auth, artworks, orders, payments, inquiries, artist
  services/                Daraja client, order settlement, earnings ledger
db/schema.sql              PostgreSQL schema
db/seed.mjs                demo studios, artworks, orders, earnings, reviews
scripts/start-db.mjs       starts a project-local PostgreSQL cluster (if PG is installed)
scripts/db-setup.mjs       creates the database, applies schema, seeds demo data
tests/api.test.js          end-to-end API tests (node:test)
docs/API.md                endpoint reference
docs/api.http              requests you can run from VS Code (REST Client)
.vscode/                   debug config, tasks, recommended extensions
```

## Requirements

- **Node.js 20+** (developed on 24)
- **PostgreSQL 14+** (developed on 18) — either an existing server, or PostgreSQL binaries
  installed locally so `npm run db:start` can create a project-local cluster in `.pgdata`

## Quick start

```bash
npm install
npm run db:start     # optional: starts a local PostgreSQL cluster on port 5433
npm run db:setup     # creates the database, applies db/schema.sql, seeds demo data
npm start            # http://localhost:4000
```

Open <http://localhost:4000> for the gallery and <http://localhost:4000/dashboard.html> for
the studio dashboard.

Demo accounts (password `Wanasanaa2026!`):

| Account | Email | Role |
| --- | --- | --- |
| Achieng Odhiambo | `collector@wanasanaa.test` | collector |
| Haku Atelier | `haku@wanasanaa.test` | artist (has sales, earnings, reviews) |
| Mael Nyx Atelier | `mael@wanasanaa.test` | artist (spotlight piece) |

`npm run db:setup` is idempotent and skips seeding when users already exist.
`npm run db:reset` drops the `public` schema and reseeds a clean demo.

### Using your own PostgreSQL

Skip `npm run db:start` and point `DATABASE_URL` at your server in `.env`:

```
DATABASE_URL=postgres://user:password@localhost:5432/wanasanaa
```

`npm run db:setup` creates the database if it is missing, applies the schema, then seeds.
For a managed database that requires TLS, set `DATABASE_SSL=true`.

### Local cluster details

`scripts/start-db.mjs` uses installed PostgreSQL binaries (`PG_BIN`, a standard Windows
install under `C:\Program Files\PostgreSQL\<version>\bin`, or `initdb`/`postgres` on `PATH`).
It initialises `./.pgdata` with trust auth on `127.0.0.1:5433`, starts the server detached, and
creates the database. Logs: `.pgdata/server.log`. This is a development convenience only —
never use trust auth or a local data directory in production.

## Environment variables

Copy `.env.example` to `.env` and edit. Defaults are development-safe.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `APP_URL` | `http://localhost:4000` | Public origin; used for cookies, origin checks, M-Pesa callback fallback |
| `NODE_ENV` | `development` | `production` enforces Daraja credentials and secure cookies |
| `DATABASE_URL` | `postgres://postgres@127.0.0.1:5433/wanasanaa` | PostgreSQL connection string |
| `DATABASE_SSL` | off | `true` for managed databases requiring TLS |
| `JWT_SECRET` | dev fallback | 32+ byte random string; **required in production** |
| `PLATFORM_COMMISSION_RATE` | `0.12` | Studio commission (0.12 → artist keeps 88%) |
| `SHIPPING_FEE_KES` | `0` | Flat insured-delivery fee in shillings |
| `MPESA_ENV` | `sandbox` | `sandbox` or `production` |
| `MPESA_BASE_URL` | derived | Override the Daraja base URL |
| `MPESA_CONSUMER_KEY` | — | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | — | Daraja app consumer secret |
| `MPESA_SHORTCODE` | `174379` | Paybill / till number |
| `MPESA_PASSKEY` | — | Lipa na M-Pesa online passkey |
| `MPESA_CALLBACK_URL` | `${APP_URL}/api/webhooks/mpesa/callback` | Public HTTPS callback |
| `MPESA_TRANSACTION_TYPE` | `CustomerPayBillOnline` | Or `CustomerBuyGoodsOnline` for a till |
| `MPESA_SIMULATE` | on when creds are absent | Force simulated payments in development |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### M-Pesa setup

1. Create a Daraja app at <https://developer.safaricom.co.ke> and get the consumer key/secret.
2. Use the sandbox test shortcode `174379` and its passkey (or your own paybill credentials).
3. Expose the callback over HTTPS. For local work, run a tunnel that forwards to
   `http://localhost:4000/api/webhooks/mpesa/callback` and put that URL in `MPESA_CALLBACK_URL`.
4. Restart the API. With credentials present, checkout sends a real STK prompt; the callback
   settles the order, writes the earnings ledger and the browser polls until paid.

Without credentials the app runs in **simulation mode**: checkout creates a real order and
reserves stock, but the payment panel shows a “Complete test payment” button instead of
prompting a phone. Simulation is refused in production (`NODE_ENV=production`).

## Using VS Code

1. Unzip the archive and open the folder (`File → Open Folder…`).
2. Accept the recommended extensions when prompted:
   - **REST Client** — run `docs/api.http` requests from inside the editor
   - **Prettier** — formatting
   - **SQLTools + PostgreSQL driver** — browse the database
3. Run `npm install` in the integrated terminal.
4. Use **Terminal → Run Task…**:
   - `DB: start local PostgreSQL`
   - `DB: setup (schema + seed)`
   - `API: dev (watch)`
   - `Test: API suite`
5. Press **F5** and choose **API server** to debug with breakpoints (`.vscode/launch.json`).
   The “API tests” configuration runs the suite under the debugger.

`docs/api.http` contains ready requests for signing in, browsing, creating a piece, checking
out and completing a simulated payment. Sign in first — REST Client keeps the session cookie.

## API

Full request/response reference: [`docs/API.md`](docs/API.md).

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | — | Liveness + database check |
| `GET /api/config` | — | Currency, shipping fee, payment mode |
| `POST /api/auth/register` | — | Collector or studio account |
| `POST /api/auth/login` / `POST /api/auth/logout` | — | Session cookie |
| `GET /api/auth/me` | optional | Current user + studio profile |
| `GET /api/artworks` | — | Published pieces, filters, pagination |
| `GET /api/artworks/featured` | — | Spotlight piece |
| `GET /api/artworks/facets` | — | Filter values |
| `GET /api/artworks/:id` | optional | Detail, reviews, review eligibility |
| `GET /api/artists`, `GET /api/artists/:id` | — | Studios and their works |
| `POST /api/inquiries` | optional | Piece or commission inquiry |
| `POST /api/artworks/:id/reviews` | collector | Verified-purchase review |
| `POST /api/orders` | collector | Checkout + STK Push, reserves stock |
| `GET /api/orders`, `GET /api/orders/:id` | owner | Orders and payment state |
| `POST /api/orders/:id/pay` | owner | Retry the STK prompt |
| `POST /api/orders/:id/cancel` | owner | Cancel and release stock |
| `POST /api/orders/:id/simulate-payment` | owner | Development-only test settlement |
| `POST /api/webhooks/mpesa/callback` | Safaricom | Payment result, idempotent |
| `GET /api/artist/summary` | artist | Earnings, inventory, customers, inquiries |
| `GET/POST /api/artist/artworks` | artist | Inventory and adding pieces |
| `PATCH/DELETE /api/artist/artworks/:id` | artist | Re-price, stock, archive |
| `GET /api/artist/earnings` | artist | KES ledger, totals, monthly net |
| `GET /api/artist/orders`, `/customers` | artist | Sales and collector list |
| `GET /api/artist/inquiries`, `PATCH /api/artist/inquiries/:id` | artist | Studio inbox |

### How money moves

1. Checkout locks the artwork rows (`SELECT … FOR UPDATE`), validates stock, inserts the order
   and its line items with the commission rate snapshot, then decrements stock to reserve it.
2. An STK Push is initiated for the exact order total; `phone` is normalised to `2547…`.
3. The Daraja callback is matched by `CheckoutRequestID`. The payment is settled once
   (idempotent), the amount is checked against the order, the receipt is stored, the order
   becomes `paid`, and one earnings row per line is written:
   `gross_kes − round(gross_kes × commission_rate) = net_kes`.
4. Cancelling an unpaid order restores stock and invalidates the open payment attempt.

## Tests

```bash
npm test
```

Runs `tests/api.test.js` against a running server (`http://127.0.0.1:4000`, override with
`TEST_BASE_URL`). It registers fresh accounts, so it can be run repeatedly. Covered:
registration/login/logout revocation, artwork creation and re-pricing, cross-studio
isolation, stock reservation and oversell rejection, checkout, simulated settlement,
earnings maths, replayed callbacks not double-crediting, verified reviews, inquiries,
cancellation restores stock, validation and permission failures.

## Security notes

- Passwords hashed with bcrypt (12 rounds); sessions are database-backed random JWT IDs in
  `httpOnly`, `SameSite=Lax` cookies, revoked on logout and expiry.
- All mutations require same-origin requests; cookies never readable by JavaScript.
- Helmet CSP limits scripts/styles/fonts; images may load from HTTPS studio CDNs.
- M-Pesa callbacks are processed inside a transaction with row locks, amount checks,
  unique receipts and idempotent settlement; simulation is disabled in production.
- Artwork uploads: JPG/PNG/WebP/AVIF only, 5 MB limit, stored in `uploads/` and served
  read-only. Query parameters are always bound (`pg`), never interpolated.
- Rate limits on login/registration, checkout, inquiries and studio writes.
- Private API responses are `Cache-Control: no-store`.

## Notes and limitations

- Payments settle asynchronously; the browser polls the order. A production deployment should
  also reconcile delayed callbacks (Daraja’s STK query endpoint is already used by
  `services/mpesa.js` and can be wired into a scheduled job).
- Studio replies to inquiries open the operator’s mail client; there is no outbound email.
- `uploads/` is local disk; production should move artwork images to object storage.
- Prices are whole shillings, matching M-Pesa. Card payments are not included.
