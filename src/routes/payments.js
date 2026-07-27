const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../auth');
const { setUserPro, markPaymentProcessed, findUserByEmail, findUserById } = require('../db');

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PRO_PRICE_KOBO = 450000; // ₦4,500 — must match the amount charged on the frontend
const PRO_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

async function verifyWithPaystack(reference) {
  const verifyRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
  );
  return verifyRes.json();
}

// Path A: called by the frontend right after the Paystack popup closes.
// Fast — the user sees their Pro status update immediately. But it depends
// on the user's browser staying open and the request actually arriving, so
// it isn't the only line of defense (see the webhook below).
router.post('/verify', requireAuth, async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) {
    return res.status(400).json({ error: 'Missing transaction reference.' });
  }
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: 'Server is not configured with a Paystack secret key yet.' });
  }

  try {
    const payload = await verifyWithPaystack(reference);

    if (!payload.status || payload.data?.status !== 'success') {
      return res.status(402).json({ error: 'Payment was not successful.' });
    }
    if (payload.data.amount < PRO_PRICE_KOBO) {
      return res.status(402).json({ error: 'Amount paid does not match the Pro price.' });
    }

    const isNew = markPaymentProcessed({
      reference,
      userId: req.userId,
      amountKobo: payload.data.amount,
      source: 'callback',
    });

    // If the webhook (below) already processed this exact reference first,
    // isNew is false — that's fine, it just means we don't apply it twice.
    // The user is still Pro either way, so we look their current state up
    // fresh rather than treating this as an error.
    if (isNew) {
      const expiresAt = new Date(Date.now() + PRO_DURATION_MS).toISOString();
      setUserPro(req.userId, true, expiresAt);
    }

    const user = findUserById(req.userId);
    res.json({ isPro: user.isPro, proExpiresAt: user.proExpiresAt });
  } catch (err) {
    console.error('Paystack verification failed:', err);
    res.status(502).json({ error: 'Could not reach Paystack to verify payment. Try again shortly.' });
  }
});

// Path B: Paystack calls this directly from their servers, independent of
// the user's browser. This is the safety net — it fires even if the user
// closes the tab the instant payment succeeds, before path A ever runs.
// Configure this URL in the Paystack dashboard under Settings → API Keys
// & Webhooks (e.g. https://your-domain.com/api/payments/webhook).
router.post('/webhook', async (req, res) => {
  // Always ack quickly so Paystack doesn't retry unnecessarily — do the
  // real work after responding is not done here for simplicity, but in a
  // high-traffic setup you'd hand this off to a queue and respond first.
  if (!PAYSTACK_SECRET_KEY) {
    console.error('Webhook received but PAYSTACK_SECRET_KEY is not set.');
    return res.sendStatus(500);
  }

  // Verify this request genuinely came from Paystack, not a random POST to
  // a guessed URL — Paystack signs the raw body with your secret key.
  const signature = req.headers['x-paystack-signature'];
  const expectedSignature = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(req.rawBody || Buffer.from(JSON.stringify(req.body)))
    .digest('hex');

  if (signature !== expectedSignature) {
    console.warn('Webhook signature mismatch — ignoring request.');
    return res.sendStatus(401);
  }

  const event = req.body;

  try {
    if (event.event === 'charge.success') {
      const { reference, amount, customer } = event.data;
      const user = findUserByEmail(customer.email);

      if (!user) {
        console.warn(`Webhook: no account found for ${customer.email}, skipping.`);
        return res.sendStatus(200);
      }
      if (amount < PRO_PRICE_KOBO) {
        console.warn(`Webhook: amount ${amount} below Pro price for ${reference}, skipping.`);
        return res.sendStatus(200);
      }

      const isNew = markPaymentProcessed({
        reference,
        userId: user.id,
        amountKobo: amount,
        source: 'webhook',
      });

      if (isNew) {
        const expiresAt = new Date(Date.now() + PRO_DURATION_MS).toISOString();
        setUserPro(user.id, true, expiresAt);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook handling failed:', err);
    // Still 200 — we don't want Paystack hammering retries for a bug on
    // our side once we've logged it; fix and reconcile manually if needed.
    res.sendStatus(200);
  }
});

module.exports = router;
