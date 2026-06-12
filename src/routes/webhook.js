// ============================================================
// RUTAS: WEBHOOK (GET + POST)
// ============================================================

import { Router } from 'express';
import dotenv from 'dotenv';
import config from '../../config/bot.config.js';
import { shouldForward, buildForwardMessage } from '../../config/hooks.js';
import { generateResponse } from '../services/ai.service.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';
import { getBusinessContext } from '../services/schedule.service.js';
import { MessageBuffer } from '../utils/buffer.js';
import { ChatHistory } from '../utils/history.js';
import { validateWebhookPayload } from '../middleware/validation.js';
import logger from '../utils/logger.js';

dotenv.config();

const router = Router();

// ── Estado en memoria ──
const chatHistory = new ChatHistory(config.maxHistory);

// Estado de pedido por cliente:
//   { pendingConfirmation: bool, confirmedDate: 'YYYY-MM-DD' | null }
const userState = new Map();

/** Fecha actual en zona horaria del negocio (formato YYYY-MM-DD). */
function getBusinessDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

/** Obtiene (o crea) el estado de un cliente. */
function getUserState(senderNumber) {
    if (!userState.has(senderNumber)) {
        userState.set(senderNumber, { pendingConfirmation: false, confirmedDate: null });
    }
    return userState.get(senderNumber);
}

/** ¿El mensaje del cliente es una confirmación corta? */
function isClientConfirming(text) {
    const { confirmationBlock } = config;
    if (!confirmationBlock) return false;
    const trimmed = text.trim();
    if (trimmed.length > confirmationBlock.maxLength) return false;
    return confirmationBlock.patterns.some(pattern => pattern.test(trimmed));
}

// ── Buffer con callback de procesamiento ──
const messageBuffer = new MessageBuffer(config.debounceMs, processBuffer);

// ============================================================
// GET /webhook — Verificación de Meta
// ============================================================
router.get('/', (req, res) => {
    const verifyToken = process.env.META_VERIFY_TOKEN || `${config.name.toLowerCase()}_token`;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            logger.info('✅ Webhook verificado exitosamente con Meta');
            return res.status(200).send(challenge);
        } else {
            logger.warn('Token de verificación inválido');
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

// ============================================================
// POST /webhook — Recepción híbrida Meta / Kapso
// ============================================================
router.post('/', validateWebhookPayload, async (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;
        logger.debug("📥 Datos recibidos en Webhook:", JSON.stringify(body, null, 2));

        let incomingMessages = [];
        let senderName = "Cliente";
        let phoneNumberId = "";

        // ── Parseo Meta ──
        const value = body.entry?.[0]?.changes?.[0]?.value;
        if (value) {
            if (value.messages) incomingMessages = value.messages;
            if (value.metadata?.phone_number_id) phoneNumberId = value.metadata.phone_number_id;
            if (value.contacts?.[0]?.profile?.name) {
                senderName = value.contacts[0].profile.name;
            }
        } else {
            // ── Parseo Kapso ──
            if (Array.isArray(body.data)) incomingMessages = body.data;
            else if (Array.isArray(body.messages)) incomingMessages = body.messages;
            else incomingMessages = [body];
        }

        let textChunk = "";
        let senderNumber = "";

        for (const item of incomingMessages) {
            const msg = item.message || item;
            const text = msg.text?.body || msg.kapso?.content || msg.text;
            const from = msg.from || msg.sender;
            const name = item.push_name || msg.push_name || msg.sender_name || item.sender_name;

            if (item.phone_number_id && !phoneNumberId) phoneNumberId = item.phone_number_id;
            if (text) textChunk += (textChunk ? "\n" : "") + text;
            if (from) senderNumber = from;
            if (name && senderName === "Cliente") senderName = name;
        }

        if (!textChunk || !senderNumber) {
            logger.debug("Webhook ignorado: sin texto o número de remitente.");
            return;
        }

        logger.info(`💬 Fragmento de ${senderName} (${senderNumber}): ${textChunk}`);

        // ── Acumular en buffer ──
        messageBuffer.add(senderNumber, textChunk, { senderName, phoneNumberId });

    } catch (error) {
        logger.error("Error en webhook:", error.message || error);
    }
});

// ============================================================
// PROCESAMIENTO DIFERIDO
// ============================================================
async function processBuffer(senderNumber, fragments, meta) {
    const combinedText = fragments.join("\n");
    const { senderName, phoneNumberId } = meta;
    const state = getUserState(senderNumber);

    // ── 1. Cliente ya confirmó su pedido hoy → ignorar por completo ──
    if (state.confirmedDate === getBusinessDate()) {
        logger.info(`🔕 ${senderName} (${senderNumber}) ya confirmó hoy. Mensaje ignorado.`);
        return;
    }

    // ── 2. ¿Cliente está confirmando (dice ok, listo, confirmado, etc.)? ──
    if (isClientConfirming(combinedText)) {
        const closing = config.confirmationBlock.closingMessage;
        logger.info(`✅ ${senderName} (${senderNumber}) confirmó. Enviando cierre y desactivando.`);
        await sendWhatsAppMessage(senderNumber, closing, phoneNumberId);
        chatHistory.add(senderNumber, combinedText, closing);
        state.pendingConfirmation = false;
        state.confirmedDate = getBusinessDate();
        return;
    }

    // ── 3. Flujo normal con IA ──
    const { instruction, type } = getBusinessContext();
    logger.info(`🧠 Generando respuesta con Gemini (${type} Agent)...`);

    const aiReply = await generateResponse(
        combinedText,
        instruction,
        chatHistory.get(senderNumber),
    );
    logger.info(`✅ Respuesta Gemini: ${aiReply}`);

    // ── Enviar al cliente ──
    await sendWhatsAppMessage(senderNumber, aiReply, phoneNumberId);

    // ── Actualizar historial ──
    chatHistory.add(senderNumber, combinedText, aiReply);

    // ── 4. ¿La IA mostró el resumen con Total? → queda a la espera de confirmación ──
    if (config.forwarding.detectMarkers.every(marker => aiReply.includes(marker))) {
        state.pendingConfirmation = true;
        logger.info(`⏳ ${senderName} (${senderNumber}) con pedido pendiente de confirmación.`);
    }

    // ── Reenvío de confirmación (genérico) ──
    const forwardNumber = config.notifications.forwarding;
    if (forwardNumber && type === 'OPEN') {
        const shouldSend = shouldForward({ aiReply, userMessage: combinedText });
        if (shouldSend) {
            logger.info("📨 Reenviando confirmación...");
            const forwardMsg = buildForwardMessage({
                aiReply,
                senderName,
                senderNumber,
            });
            await sendWhatsAppMessage(forwardNumber, forwardMsg, phoneNumberId);
        }
    }
}

export default router;
