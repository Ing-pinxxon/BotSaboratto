// ============================================================
// RUTAS: WEBHOOK (GET + POST)
// ============================================================

import { Router } from 'express';
import dotenv from 'dotenv';
import config from '../../config/bot.config.js';
import { buildKitchenComanda, extractItems, parseOrderAmounts } from '../../config/hooks.js';
import { generateResponse } from '../services/ai.service.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';
import { saveOrder, nextOrderNumber } from '../services/orders.service.js';
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
//   { pendingConfirmation: bool, confirmedDate: 'YYYY-MM-DD' | null,
//     lastOrderSummary: string | null, lastOrderAt: number | null }
const userState = new Map();

/** Fecha actual en zona horaria del negocio (formato YYYY-MM-DD). */
function getBusinessDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

/** Obtiene (o crea) el estado de un cliente. */
function getUserState(senderNumber) {
    if (!userState.has(senderNumber)) {
        userState.set(senderNumber, {
            pendingConfirmation: false,
            confirmedDate: null,
            lastOrderSummary: null,
            lastOrderAt: null,
        });
    }
    return userState.get(senderNumber);
}

/** Dígitos de un número (sin +, espacios ni símbolos). */
function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/**
 * ¿El número de cocina es la MISMA línea del bot? WhatsApp no permite que
 * un número se envíe mensajes a sí mismo, así que en ese caso se omite el
 * envío. Compara los últimos 10 dígitos para tolerar prefijos (57, +57…).
 */
function isSameAsBot(kitchenNumber) {
    const a = onlyDigits(kitchenNumber);
    const b = onlyDigits(config.contactNumber);
    if (!a || !b) return false;
    return a.slice(-10) === b.slice(-10);
}

/**
 * Al confirmar el cliente: genera la comanda con el último resumen del
 * pedido, la envía al número de cocina (1:1) y guarda el boucher
 * (CSV local + Google Sheets). No hace nada si no hubo un pedido con total.
 */
async function dispatchConfirmedOrder({ state, senderName, senderNumber, phoneNumberId }) {
    const orderSummary = state.lastOrderSummary;
    if (!orderSummary) return;   // el cliente confirmó sin un pedido con total
    state.lastOrderSummary = null;  // evitar duplicar el mismo pedido

    const businessDate = getBusinessDate();
    const orderNumber = nextOrderNumber(businessDate);
    const now = new Date();
    const time = now.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.timezone,
    });

    // ── Enviar comanda a cocina (número 1:1) ──
    const kitchenNumber = config.notifications.forwarding;
    if (kitchenNumber && isSameAsBot(kitchenNumber)) {
        // WhatsApp no permite auto-envío: la comanda queda solo en el boucher.
        logger.warn(`👨‍🍳 Comanda #${orderNumber} guardada en boucher (Sheets/CSV). No se envía por WhatsApp: KITCHEN_NUMBER es la misma línea del bot.`);
    } else if (kitchenNumber && process.env.ZERNIO_API_KEY) {
        // Zernio solo responde dentro de una conversación existente, no a un
        // número arbitrario. La comanda queda en el boucher (Sheets/CSV).
        logger.warn(`👨‍🍳 Comanda #${orderNumber} guardada en boucher. Envío a cocina omitido: Zernio no reenvía a un número aparte (usa el tablero de Google Sheets).`);
    } else if (kitchenNumber) {
        const comanda = buildKitchenComanda({ orderSummary, senderName, senderNumber, orderNumber });
        logger.info(`👨‍🍳 Enviando comanda #${orderNumber} a cocina (${kitchenNumber})...`);
        await sendWhatsAppMessage(kitchenNumber, comanda, phoneNumberId);
    } else {
        logger.warn('KITCHEN_NUMBER no configurado: la comanda solo se guarda, no se envía por WhatsApp.');
    }

    // ── Guardar boucher (traza) ──
    const amounts = parseOrderAmounts(orderSummary);
    await saveOrder({
        businessDate,
        time,
        orderNumber,
        senderName,
        senderNumber,
        items: extractItems(orderSummary),
        subtotal: amounts.subtotal,
        icopor: amounts.icopor,
        domicilio: amounts.domicilio,
        total: amounts.total,
        diaSemana: now.toLocaleDateString('es-CO', { weekday: 'long', timeZone: config.timezone }),
        rawSummary: orderSummary,
    });
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

        // ── Parseo Zernio (proveedor oficial) ──
        // Estructura real:
        //   { event, message: { direction, text, sender: { phoneNumber, name } },
        //     conversation: { participantId, participantUsername } }
        const zMsg = (body?.message && typeof body.message === 'object' && !Array.isArray(body.message))
            ? body.message
            : null;
        const isZernio = !!(body?.event || body?.conversation || (zMsg && zMsg.direction !== undefined));
        if (isZernio) {
            // Solo procesar mensajes ENTRANTES reales. Ignorar salientes (evita que
            // el bot se responda a sí mismo) y eventos de estado (delivered/read/sent).
            const dir = String(zMsg?.direction || "").toLowerCase();
            if (!zMsg || dir !== "incoming") {
                logger.debug(`Webhook Zernio ignorado: evento "${body?.event}", direction "${dir}".`);
                return;
            }

            const zText = typeof zMsg.text === "string" ? zMsg.text : zMsg.text?.body;
            const zFrom = String(
                zMsg.sender?.phoneNumber
                || body?.conversation?.participantId
                || body?.conversation?.participantUsername
                || zMsg.sender?.id
                || ""
            ).replace(/^\+/, "");
            const zName = zMsg.sender?.name || body?.conversation?.participantName || "Cliente";

            if (!zText || !zFrom) {
                logger.debug("Webhook Zernio ignorado: sin texto o número de remitente.");
                return;
            }

            // Datos necesarios para responder por Zernio (envío por conversación).
            const zConversationId = zMsg.conversationId || body?.conversation?.id;
            const zAccountId = body?.account?.id || body?.account?.accountId;

            logger.info(`💬 Fragmento de ${zName} (${zFrom}): ${zText}`);
            messageBuffer.add(zFrom, zText, {
                senderName: zName,
                phoneNumberId: "",
                zernioConversationId: zConversationId,
                zernioAccountId: zAccountId,
            });
            return;
        }

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
    const { senderName, phoneNumberId, zernioConversationId, zernioAccountId } = meta;
    const zernio = { conversationId: zernioConversationId, accountId: zernioAccountId };
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
        await sendWhatsAppMessage(senderNumber, closing, phoneNumberId, zernio);
        chatHistory.add(senderNumber, combinedText, closing);
        state.pendingConfirmation = false;
        state.confirmedDate = getBusinessDate();

        // ── Comanda a cocina + boucher (traza). No debe romper el cierre. ──
        try {
            await dispatchConfirmedOrder({ state, senderName, senderNumber, phoneNumberId });
        } catch (error) {
            logger.error('Error al despachar el pedido confirmado:', error.message || error);
        }
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
    await sendWhatsAppMessage(senderNumber, aiReply, phoneNumberId, zernio);

    // ── Actualizar historial ──
    chatHistory.add(senderNumber, combinedText, aiReply);

    // ── 4. ¿La IA mostró el resumen con Total? → guardar como "último pedido"
    //        y quedar a la espera de confirmación. La comanda a cocina se
    //        genera recién cuando el cliente confirma (paso 2). ──
    if (config.forwarding.detectMarkers.every(marker => aiReply.includes(marker))) {
        state.pendingConfirmation = true;
        state.lastOrderSummary = aiReply;
        state.lastOrderAt = Date.now();
        logger.info(`⏳ ${senderName} (${senderNumber}) con pedido pendiente de confirmación.`);
    }
}

export default router;
