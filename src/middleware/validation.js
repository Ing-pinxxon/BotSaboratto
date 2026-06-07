// ============================================================
// MIDDLEWARE: VALIDACIÓN DE PAYLOADS
// ============================================================

import logger from '../utils/logger.js';

/**
 * Valida que el body del webhook tenga estructura mínima esperada.
 * No bloquea — solo loguea si hay datos sospechosos.
 */
export function validateWebhookPayload(req, res, next) {
    const body = req.body;

    if (!body || typeof body !== 'object') {
        logger.warn('Payload vacío o inválido recibido en webhook');
        return res.sendStatus(400);
    }

    next();
}

/**
 * Valida el payload de notificación de pago.
 */
export function validatePaymentPayload(req, res, next) {
    const body = req.body;

    if (!body || typeof body !== 'object') {
        logger.warn('Payload de pago vacío o inválido');
        return res.sendStatus(400);
    }

    next();
}
