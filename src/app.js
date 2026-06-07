// ============================================================
// EXPRESS APP SETUP
// Configuración de Express: middlewares y rutas.
// ============================================================

import express from 'express';
import { securityHeaders } from './middleware/security.js';
import webhookRouter from './routes/webhook.js';
import paymentsRouter from './routes/payments.js';
import logger from './utils/logger.js';

const app = express();

// ── Middlewares globales ──
app.use(express.json());
app.use(securityHeaders);

// ── Rutas ──
app.use('/webhook', webhookRouter);
app.use('/notify-payment', paymentsRouter);

// ── Healthcheck ──
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Manejo de errores global ──
app.use((err, req, res, next) => {
    logger.error('Error no manejado:', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
});

export default app;
