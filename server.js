require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./src/routes/auth');
const paymentRoutes = require('./src/routes/payments');

const app = express();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5500';

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
// The verify callback stashes the exact raw bytes Paystack sent, before
// they're parsed into req.body — signature verification has to run over
// those exact bytes, not a re-serialized copy (whitespace/key-order
// differences would make a valid signature look invalid).
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.send('Loopline API is running 🚀'));

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);

// Centralized error handler — catches anything that slips past a route's own
// try/catch so a bug never leaks a stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Loopline API running at http://localhost:${PORT}`);
  console.log(`Accepting requests from ${FRONTEND_ORIGIN}`);
});
