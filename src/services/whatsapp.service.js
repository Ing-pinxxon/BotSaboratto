// ============================================================
// WHATSAPP SERVICE
// Envío de mensajes por Zernio (proveedor oficial de WhatsApp).
// Zernio responde DENTRO de una conversación existente:
//   POST /inbox/conversations/{conversationId}/messages
// ============================================================

import axios from 'axios';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_BASE_URL = process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1';

/**
 * Envía un payload a la conversación de Zernio.
 *
 * @param {string} to       - Número del cliente (solo para logs)
 * @param {object} body     - Campos del mensaje (message, attachmentUrl, ...)
 * @param {object} zernio   - { conversationId, accountId }
 * @param {string} label    - Descripción para el log
 */
async function postToConversation(to, body, zernio = {}, label = 'Mensaje') {
    const conversationId = zernio.conversationId;
    const accountId = zernio.accountId || process.env.ZERNIO_ACCOUNT_ID;

    if (!ZERNIO_API_KEY) {
        logger.error(`No se pudo enviar a ${to}: falta ZERNIO_API_KEY.`);
        return;
    }
    if (!conversationId) {
        logger.error(`No se pudo enviar a ${to}: falta conversationId (Zernio solo responde dentro de una conversación existente).`);
        return;
    }

    const url = `${ZERNIO_BASE_URL}/inbox/conversations/${conversationId}/messages`;
    const payload = { ...body };
    if (accountId) payload.accountId = accountId;

    try {
        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ZERNIO_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        logger.info(`📤 ${label} → ${to} (conv ${conversationId})`);
    } catch (error) {
        logger.error(`Error al enviar (${label}) a ${to}:`, error.response?.data || error.message);
    }
}

/**
 * Envía un mensaje de texto al cliente.
 *
 * @param {string} to       - Número del cliente
 * @param {string} text     - Texto del mensaje
 * @param {object} [zernio] - { conversationId, accountId }
 */
export async function sendWhatsAppMessage(to, text, zernio = {}) {
    await postToConversation(to, { message: text }, zernio, 'Mensaje');
}

/**
 * Envía una imagen (URL pública JPG/PNG, máx. 5 MB) al cliente.
 *
 * @param {string} to        - Número del cliente
 * @param {string} imageUrl  - URL pública de la imagen
 * @param {string} [caption] - Texto opcional que acompaña la imagen
 * @param {object} [zernio]  - { conversationId, accountId }
 */
export async function sendWhatsAppImage(to, imageUrl, caption = '', zernio = {}) {
    const body = { attachmentUrl: imageUrl, attachmentType: 'image' };
    if (caption) body.message = caption;
    await postToConversation(to, body, zernio, 'Imagen');
}
