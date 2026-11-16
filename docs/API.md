# Wanasanaa API reference

Base URL: `http://localhost:4000`. All responses are JSON. The session is an `httpOnly`
cookie set by login/registration; browser clients also accept `Authorization: Bearer <jwt>`
for API tooling.

Errors use one shape:

```json
{ "error": { "code": "insufficient_stock", "message": "Some pieces are no longer available.", "details": [] } }
```

| Status | Meaning |
| --- | --- |
| 400 | Malformed request (e.g. invalid phone) |
| 401 | No live session |
| 403 | Wrong role / not the owner / cross-origin mutation |
| 404 | Unknown record |
| 409 | Stock, duplicate or state conflict |
| 413 | Image over 5 MB |
| 415 | Unsupported upload type |
| 422 | Validation failure (`details` lists fields) |
| 429 | Rate limited |

Money fields are integers in **Kenyan shillings**; `currency` is always `"KES"`.

---

## System

### `GET /api/health`

```json
{ "status": "ok", "database": "connected", "time": "2026-11-16T10:44:51.708Z" }
```

### `GET /api/config`

```json
{
  "platform": { "currency": "KES", "commissionRate": 0.12, "shippingKes": 0, "name": "Wanasanaa Contemporary" },
  "payments": { "provider": "mpesa", "environment": "sandbox", "simulate": true, "instructions": "Simulation mode…" }
}
```

---

## Authentication

### `POST /api/auth/register`

```json
{
  "name": "Wanjiku Mwangi",
  "email": "wanjiku@example.com",
  "password": "at-least-8-chars",
  "role": "artist",
  "phone": "0712345678",
  "studioName": "Wanjiku Atelier",
  "location": "Nairobi",
  "discipline": "Hand-forged silver",
  "bio": "Bench jeweller working in recycled silver."
}
```

`role` is `"collector"` (default) or `"artist"`; studio fields are used only for artists.
Returns `201 { user }` and sets the session cookie. Duplicate email → `409 email_in_use`.

### `POST /api/auth/login`

```json
{ "email": "haku@wanasanaa.test", "password": "Wanasanaa2026!" }
```

Returns `{ user }`. Wrong credentials → `401`.

### `POST /api/auth/logout`

Deletes the session row and clears the cookie. `{ "ok": true }`.

### `GET /api/auth/me`

```json
{
  "user": { "id": "…", "name": "Haku Mori", "email": "haku@wanasanaa.test", "role": "artist", "phone": null },
  "artist": { "id": "…", "studio_name": "Haku Atelier", "location": "Kyoto", "verified": true, "commission_rate": "0.1200" }
}
```

Signed out: `{ "user": null }`.

---

## Public catalogue

### `GET /api/artworks`

Query: `q`, `category`, `metal`, `gemstone`, `artist` (uuid), `sort` (`curated|newest|price_asc|price_desc|rating`), `page`, `limit` (≤48).
Only `status = published` pieces with stock > 0 are returned.

```json
{
  "artworks": [
    {
      "id": "…", "title": "Kintsugi Ceramic Ring", "description": "…",
      "medium": "Celadon porcelain, 24k gold lacquer", "category": "Ceramic & Pottery",
      "metal": "18k Recycled Gold", "gemstone": null, "dimensions": "US 7, 12mm band",
      "price_kes": 41000, "stock": 1, "one_of_a_kind": false,
      "image_url": "https://…", "is_featured": false,
      "artist_id": "…", "studio_name": "Haku Atelier", "artist_location": "Kyoto", "verified": true,
      "avg_rating": 5, "review_count": 1
    }
  ],
  "pagination": { "page": 1, "limit": 12, "total": 8, "pages": 1 }
}
```

### `GET /api/artworks/featured`

`{ "artwork": { … } }` — featured piece, otherwise the highest-priced published work.

### `GET /api/artworks/facets`

`{ "categories": [{ "value", "count" }], "metals": […], "gemstones": […] }`.

### `GET /api/artworks/:id`

`{ "artwork": { …, "artist_bio", "artist_discipline" }, "reviews": [], "canReview": false, "myReview": null, "signedIn": true }`

### `GET /api/artworks/:id/reviews`

`{ "reviews": [{ "id", "rating", "title", "body", "created_at", "reviewer" }] }`

### `POST /api/artworks/:id/reviews` — collector session

Requires a paid order containing the piece; one review per collector per piece.

```json
{ "rating": 5, "title": "The seam is the point", "body": "Beautifully finished and well packaged." }
```

`201 { review }`. No purchase → `409 purchase_required`; duplicate → `409 already_reviewed`.

### `GET /api/artists` · `GET /api/artists/:id`

Studio list with published piece counts, or one studio plus its available works.

---

## Inquiries

### `POST /api/inquiries` — public (session optional)

```json
{
  "artworkId": "…",
  "artistId": "…",
  "name": "Achieng Odhiambo",
  "email": "achieng@example.com",
  "phone": "0712345678",
  "subject": "Commission inquiry — Solstice ring",
  "message": "Could this be resized and set with a darker stone?",
  "budgetKes": 600000
}
```

`artworkId` routes to that piece’s studio and overrides `artistId`. Either may be omitted for
a general commission brief. `201 { inquiry, message }`.

---

## Checkout & payments — collector session

### `POST /api/orders`

Reserves stock atomically, creates the order and starts an M-Pesa STK Push.

```json
{
  "items": [{ "artworkId": "…", "quantity": 1 }],
  "phone": "0712 345 678",
  "shipping": { "name": "Achieng Odhiambo", "phone": "0712345678", "address": "12 Ngong Road", "city": "Nairobi" },
  "notes": "Gift wrapping"
}
```

```json
{
  "order": {
    "id": "…", "order_number": "WS-…", "status": "pending_payment", "currency": "KES",
    "subtotal_kes": 41000, "shipping_kes": 0, "total_kes": 41000,
    "items": [{ "title": "Kintsugi Ceramic Ring", "quantity": 1, "unit_price_kes": 41000, "line_total_kes": 41000, "studio_name": "Haku Atelier" }],
    "payment": { "status": "initiated", "phone": "254712345678", "amount_kes": 41000, "simulated": true, "checkout_request_id": "ws_CO_SIM_…" }
  },
  "simulated": true
}
```

If the STK request fails the order still exists (`201` with `payment: null, paymentError`) so
the customer can retry without losing the reservation. Insufficient stock → `409 insufficient_stock`.

### `GET /api/orders` · `GET /api/orders/:id`

Order list, or one order with items and latest payment attempt.

### `POST /api/orders/:id/pay`

```json
{ "phone": "0712345678" }
```

Starts (or retries) the prompt for a `pending_payment` order. Paid order → `409 already_paid`.

### `POST /api/orders/:id/cancel`

Cancels an unpaid order, restores stock and closes open payment attempts.

### `POST /api/orders/:id/simulate-payment` — development only

```json
{ "outcome": "success" }
```

Completes the buyer’s pending simulated payment exactly as a Daraja callback would. Disabled
when real credentials are configured (`403`).

### `POST /api/webhooks/mpesa/callback`

Safaricom’s payload:

```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_191220191020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": { "Item": [{ "Name": "Amount", "Value": 41000 }, { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" }] }
    }
  }
}
```

Always answers `200 { "ResultCode": 0, "ResultDesc": "Accepted" }`. Unknown IDs are ignored;
replays are idempotent; underpayment, duplicate receipts and cancelled orders do not credit
earnings (cancelled-order payments are flagged for refund).

---

## Studio dashboard — artist session

### `GET /api/artist/summary`

```json
{
  "currency": "KES",
  "artist": { "id": "…", "studio_name": "Haku Atelier", "location": "Kyoto", "verified": true, "commission_rate": 0.12 },
  "earnings": { "total_net_kes": 36080, "platform_fees_kes": 4920, "available_kes": 36080, "sold_lines": 1, "awaiting_payment_kes": 0, "awaiting_payment_orders": 0 },
  "sales": { "paid_orders": 1, "units_sold": 1, "gross_sales_kes": 41000, "customers": 1 },
  "inventory": { "artworks": 1, "published": 1, "drafts": 0, "units_in_stock": 1, "out_of_stock": 0, "low_stock": 1 },
  "reviews": { "review_count": 1, "average_rating": 5 },
  "inquiries": { "total": 2, "new": 1 },
  "recent_sales": [], "top_artworks": [], "monthly_earnings": []
}
```

### `GET /api/artist/artworks`

Own pieces (archived excluded unless `?include_archived=true`), each with `stock`,
`units_sold`, `revenue_kes`, `avg_rating`, `review_count`, `inquiry_count`.

### `POST /api/artist/artworks`

`multipart/form-data` (photo upload) or JSON. Field names: `title`, `description`, `medium`,
`category`, `metal`, `gemstone`, `dimensions`, `price_kes`, `stock`, `one_of_a_kind`,
`image` (file) or `image_url`, `status` (`published|draft`).

```html
<form method="post" enctype="multipart/form-data">
  title, price_kes=48000, stock=1, one_of_a_kind=true, image=ring.jpg, status=published
</form>
```

`201 { artwork }`. Images: JPG/PNG/WebP/AVIF, ≤5 MB.

### `PATCH /api/artist/artworks/:id`

Any of the create fields — typically `{ "price_kes": 52000, "stock": 2 }` or
`{ "status": "archived" }`. Returns `{ artwork }`.

### `DELETE /api/artist/artworks/:id`

Soft-archives the piece: `{ "artwork": { "id", "status": "archived" } }`.

### `GET /api/artist/earnings`

```json
{
  "currency": "KES",
  "commission_rate": 0.12,
  "totals": { "gross_kes": 41000, "platform_fees_kes": 4920, "net_kes": 36080 },
  "monthly": [{ "month": "2026-11", "net_kes": 36080, "sales": 1 }],
  "earnings": [{ "artwork_title": "Kintsugi Ceramic Ring", "order_number": "WS-…", "gross_kes": 41000, "platform_fee_kes": 4920, "net_kes": 36080, "status": "available" }]
}
```

### `GET /api/artist/orders` · `GET /api/artist/orders/:id`

Orders containing the studio’s pieces (buyer, delivery details, items, per-line net).
Orders without the studio’s work → `403`.

### `GET /api/artist/customers`

Distinct collectors with `orders`, `pieces`, `spend_kes`, `last_order_at`.

### `GET /api/artist/inquiries` · `PATCH /api/artist/inquiries/:id`

Inbox (optional `?status=new|replied|closed`) and status updates:

```json
{ "status": "replied" }
```
