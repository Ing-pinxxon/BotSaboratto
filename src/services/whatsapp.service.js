// ============================================================
// WHATSAPP SERVICE
// Envío de mensajes con soporte híbrido Meta Cloud API / Kapso.
// ============================================================

import axios from 'axios';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const KAPSO_API_KEY = process.env.KAPSO_API_KEY;
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_BASE_URL = process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1';

/**
 * Envía un mensaje de WhatsApp al destinatario.
 * Detecta automáticamente si usar Meta Cloud API o Kapso.
 *
 * @param {string} to              - Número destino
 * @param {string} text            - Texto del mensaje
 * @param {string} phoneNumberId   - ID del número de teléfono de Meta
 * @param {object} [zernio]        - Datos de Zernio: { conversationId, accountId }
 */
export async function sendWhatsAppMessage(to, text, phoneNumberId, zernio = {}) {
    const metaToken = process.env.META_ACCESS_TOKEN;
    const activePhoneId = phoneNumberId || process.env.DEFAULT_PHONE_NUMBER_ID;

    try {
        if (ZERNIO_API_KEY) {
            // ── Enviar vía Zernio (proveedor oficial, Bearer token) ──
            // Zernio responde DENTRO de una conversación existente:
            //   POST /inbox/conversations/{conversationId}/messages  { accountId, message }
            const conversationId = zernio.conversationId;
            const accountId = zernio.accountId || process.env.ZERNIO_ACCOUNT_ID;
            if (!conversationId) {
                logger.error(`No se pudo enviar vía Zernio a ${to}: falta conversationId (Zernio solo responde dentro de una conversación existente).`);
                return;
            }
            const url = `${ZERNIO_BASE_URL}/inbox/conversations/${conversationId}/messages`;
            const payload = { message: text };
            if (accountId) payload.accountId = accountId;

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${ZERNIO_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            });
            logger.info(`📤 Mensaje enviado a ${to} (Vía Zernio, conv ${conversationId})`);
        } else if (metaToken && activePhoneId) {
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
