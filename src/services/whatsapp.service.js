// ============================================================
// WHATSAPP SERVICE
// Envío de mensajes con soporte híbrido Meta Cloud API / Kapso.
// ============================================================

import axios from 'axios';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const KAPSO_API_KEY = process.env.KAPSO_API_KEY;

/**
 * Envía un mensaje de WhatsApp al destinatario.
 * Detecta automáticamente si usar Meta Cloud API o Kapso.
 *
 * @param {string} to              - Número destino
 * @param {string} text            - Texto del mensaje
 * @param {string} phoneNumberId   - ID del número de teléfono de Meta
 */
export async function sendWhatsAppMessage(to, text, phoneNumberId) {
    const metaToken = process.env.META_ACCESS_TOKEN;
    const activePhoneId = phoneNumberId || process.env.DEFAULT_PHONE_NUMBER_ID;

    try {
        if (metaToken && activePhoneId) {
            // ── Enviar vía Meta WhatsApp Cloud API ──
            const url = `https://graph.facebook.com/v21.0/${activePhoneId}/messages`;
            const payload = {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: { body: text },
            };

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${metaToken}`,
                    'Content-Type': 'application/json',
                },
            });
            logger.info(`📤 Mensaje enviado a ${to} (Vía Meta Cloud API)`);
        } else if (activePhoneId) {
            // ── Enviar vía Kapso con API oficial (Meta proxy) ──
            const url = `https://api.kapso.ai/meta/whatsapp/v24.0/${activePhoneId}/messages`;
            const payload = {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: { body: text },
            };

            await axios.post(url, payload, {
                headers: {
                    'X-API-Key': KAPSO_API_KEY,
                    'Content-Type': 'application/json',
                },
            });
            logger.info(`📤 Mensaje enviado a ${to} (Vía Kapso Cloud API)`);
        } else {
            // ── Enviar vía Kapso (Legacy/Respaldo sin ID de teléfono) ──
            const url = `https://app.kapso.ai/api/v1/whatsapp_messages`;
            const payload = {
                message: {
                    phone_number: to,
                    message_type: "text",
                    content: text,
                }
            };

            await axios.post(url, payload, {
                headers: {
                    'X-API-Key': KAPSO_API_KEY,
                    'Content-Type': 'application/json',
                },
            });
            logger.info(`📤 Mensaje enviado a ${to} (Vía Kapso Legacy API)`);
        }
    } catch (error) {
        logger.error('Error al enviar mensaje:', error.response?.data || error.message);
    }
}
