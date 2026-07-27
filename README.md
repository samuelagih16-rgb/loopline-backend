# Loopline API

A minimal backend for the Loopline site: real accounts, hashed passwords,
session cookies, and server-side verification of Paystack payments before
anyone is marked as "Pro."

## Why this exists

The frontend alone can never be trusted to decide who paid — anyone can
open dev tools and fake a "success" alert in the browser. This server is
the piece that actually checks with Paystack directly before granting
access.

## What's here

```
server.js              Express app + route wiring
src/db.js               Real SQLite database (node:sqlite — no native build step)
src/auth.js              JWT signing + auth middleware (reads an httpOnly cookie)
src/routes/auth.js       /signup /login /logout /me
src/routes/payments.js   /verify (frontend-triggered) + /webhook (Paystack-triggered)
.env.example             Required secrets, documented
```

**Requires Node 22.5 or newer** — this uses Node's built-in `node:sqlite`
module so there's a real, persistent SQL database (`data/loopline.db`)
with zero native compilation and zero extra dependency to install. Check
your version with `node --version`; if you're on something older, either
upgrade Node or swap in `better-sqlite3` (same API shape) in `src/db.js`.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create your .env**
   ```
   cp .env.example .env
   ```
   Then fill in:
   - `JWT_SECRET` — generate one with:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `PAYSTACK_SECRET_KEY` — from your Paystack dashboard (Settings → API Keys).
     Use the **test** secret key (`sk_test_...`) while developing. Never the
     public key here — this one must stay server-side only.
   - `FRONTEND_ORIGIN` — wherever you're serving the HTML files from
     (e.g. `http://127.0.0.1:5500` if using VS Code's Live Server).

3. **Run it**
   ```
   npm start
   ```
   or, to auto-restart on file changes:
   ```
   npm run dev
   ```

   You should see:
   ```
   Loopline API running at http://localhost:4000
   ```

4. **Serve the frontend files** (`loopline-homepage.html`, `signup.html`,
   `lesson-structuring-a-page.html`) from a simple local server on the
   origin you set as `FRONTEND_ORIGIN` — opening them as `file://` won't
   work because cookies and CORS need a real origin. The easiest options:
   - VS Code's "Live Server" extension (defaults to `127.0.0.1:5500`)
   - or: `npx serve .` from the folder holding the HTML files

5. Open `signup.html` in your browser, create an account, and check
   `data/db.json` — you'll see a real hashed password and a user record.

## How the payment flow works end to end

There are two independent paths, and either one alone is enough to grant
Pro access — the point is that the user isn't stuck if one fails.

**Path A — frontend callback (fast, but depends on the browser)**
1. User clicks **Go Pro** and pays through the Paystack popup (client-side,
   using your **public** key).
2. Paystack's popup returns a transaction `reference` to the browser.
3. The frontend sends that reference to `POST /api/payments/verify`.
4. This server calls Paystack's `GET /transaction/verify/:reference` using
   your **secret** key, and only grants Pro if the status is `success` and
   the amount matches.
5. The frontend calls `GET /api/auth/me` to refresh the user's Pro status.

**Path B — Paystack webhook (slower, but doesn't depend on the browser)**
1. Paystack calls `POST /api/payments/webhook` directly from their own
   servers the moment a charge succeeds — even if the user closed the tab
   half a second after paying.
2. The request's signature (`x-paystack-signature` header) is checked
   against an HMAC of the raw body using your secret key, so a random POST
   to a guessed URL can't fake a payment.
3. The user is looked up by the email on the transaction and granted Pro,
   same amount check as path A.

**Both paths write to the same `processed_payments` table**, keyed by
transaction reference. Whichever path arrives first records the reference;
if the other path also fires for the same reference, it sees the record
already exists and skips re-applying it — so a payment can never be
double-counted or replayed.

To wire up the webhook: in your Paystack dashboard, go to
**Settings → API Keys & Webhooks** and set the webhook URL to
`https://your-domain.com/api/payments/webhook` (this only works once the
server is deployed somewhere with a public URL — Paystack can't reach
`localhost`).

## Before this touches real users

- `data/loopline.db` is a single SQLite file — fine for a project this
  size, but for meaningfully concurrent traffic you'd eventually move to
  Postgres. Because storage is isolated in `src/db.js`, that's a rewrite
  of one file, not the whole app.
- Set `NODE_ENV=production` so cookies get the `secure` flag (HTTPS only).
- Back up `data/loopline.db` regularly — it's the only copy of your data.
- Add input validation more thoroughly (a library like `zod` helps) and
  consider email verification before treating an account as fully active.
