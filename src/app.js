require('dotenv').config();
const express = require('express');
const cors = require('cors');
const invoicesRouter = require('./routes/invoices');
const companiesRouter = require('./routes/companies');
const adminRouter = require('./routes/admin');
const productsRouter = require('./routes/products');
const reportsRouter = require('./routes/reports');
const ctesRouter = require('./routes/ctes');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS policy'));
  },
}));

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/invoices', invoicesRouter);
app.use('/companies', companiesRouter);
app.use('/admin', adminRouter);
app.use('/products', productsRouter);
app.use('/reports', reportsRouter);
app.use('/ctes', ctesRouter);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;
  const payload = {
    error: err.message || 'Erro interno',
  };

  if (err.details) {
    payload.details = err.details;
  }

  res.status(status).json(payload);
});

module.exports = app;
