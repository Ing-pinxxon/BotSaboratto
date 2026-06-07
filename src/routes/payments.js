// ============================================================
// RUTAS: NOTIFICACIÓN DE PAGOS
// ============================================================

import { Router } from 'express';
import dotenv from 'dotenv';
import config from '../../config/bot.config.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';
import { validatePaymentPayload } from '../middleware/validation.js';
import logger from '../utils/logger.js';

dotenv.config();

const router = Router();

/**
 * POST /notify-payment
 * Recibe notificaciones de pago reenviadas (vía correo, SMS, Zapier, MacroDroid).
 * Espera JSON: { "monto": "25000", "metodo": "Bold / Nequi", "pagador": "Cliente" }
 */
router.post('/', validatePaymentPayload, async (req, res) => {
    res.sendStatus(200);

    try {
        const payload = req.body;
        logger.info('\n💳 ====== NUEVA NOTIFICACIÓN DE PAGO ======');
        logger.debug(JSON.stringify(payload, null, 2));

        const monto = payload.monto || '(Ver monto en app)';
        const metodo = payload.metodo || 'QR / Link / Transferencia';
        const pagador = payload.pagador || 'Cliente';

        const hora = new Date().toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: config.timezone,
        });

        const mensaje =
            `🟢 *¡PAGO RECIBIDO!*\n\n` +
            `👤 *De:* ${pagador}\n` +
            `💰 *Monto:* ${monto}\n` +
            `📱 *Vía:* ${metodo}\n` +
            `🕒 *Hora:* ${hora}\n\n` +
            `✅ El pago ha sido confirmado.\n` +
            `¡Pueden continuar con el servicio! 🚀`;

        const notifyNumber = config.notifications.payments;
        const defaultPhoneId = process.env.DEFAULT_PHONE_NUMBER_ID;

        if (notifyNumber) {
            await sendWhatsAppMessage(notifyNumber, mensaje, defaultPhoneId);
            logger.info('✅ Notificación de pago enviada al equipo');
        } else {
            logger.warn('Número de notificación de pagos no configurado.');
        }

        logger.info('💳 ====== FIN NOTIFICACIÓN ======\n');

    } catch (error) {
        logger.error('Error en webhook de pagos:', error.message || error);
    }
});

export default router;
