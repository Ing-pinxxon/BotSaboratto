// ============================================================
// RUTAS: WEBHOOK (Zernio)
// ============================================================

import { Router } from 'express';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../../config/bot.config.js';
import { extractItems, parseOrderAmounts } from '../../config/hooks.js';
import { generateResponse } from '../services/ai.service.js';
import { sendWhatsAppMessage, sendWhatsAppImage } from '../services/whatsapp.service.js';
import { saveOrder, nextOrderNumber } from '../services/orders.service.js';
import { crearPedidoDesdeResumen } from '../services/comandas.service.js';
import { getBusinessContext } from '../services/schedule.service.js';
import { MessageBuffer } from '../utils/buffer.js';
import { ChatHistory } from '../utils/history.js';
import { validateWebhookPayload } from '../middleware/validation.js';
import { isPaused, setPause, getState } from '../utils/botState.js';
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

// ── Menú en imágenes ──
const MENU_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'menu');

/**
 * Envía las imágenes del menú configuradas en bot.config.js (menuImages).
 * Las que no existan en public/menu/ se omiten con un aviso en el log.
 */
async function sendMenuImages(senderNumber, zernio) {
    const { publicBaseUrl, files } = config.menuImages;
    const base = publicBaseUrl.replace(/\/+$/, '');
    for (const file of files) {
        if (!existsSync(join(MENU_DIR, file))) {
            logger.warn(`🖼️ Imagen del menú no encontrada: public/menu/${file}. Súbela al repo para que se envíe.`);
            continue;
        }
        await sendWhatsAppImage(senderNumber, `${base}/menu/${encodeURIComponent(file)}`, '', zernio);
    }
}

/**
 * Al confirmar el cliente: guarda el boucher (CSV local + Google Sheets)
 * y lo publica en la pantalla de comandas. Con Zernio no se puede enviar
 * la comanda por WhatsApp a un número aparte (solo se responde dentro de
 * la conversación del cliente). No hace nada si no hubo un pedido con total.
 */
async function dispatchConfirmedOrder({ state, senderName, senderNumber }) {
    const orderSummary = state.lastOrderSummary;
    if (!orderSummary) return;   // el cliente confirmó sin un pedido con total
    state.lastOrderSummary = null;  // evitar duplicar el mismo pedido

    const businessDate = getBusinessDate();
    const orderNumber = nextOrderNumber(businessDate);
    const now = new Date();
    const time = now.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.timezone,
    });

    logger.info(`👨‍🍳 Comanda #${orderNumber} de ${senderName} guardada en boucher y pantalla de comandas.`);

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

    // ── Publicar en la pantalla de comandas (Supabase) ──
    // Entra marcado como "sin revisar" para que el personal lo apruebe.
    // No se espera la respuesta: si algo falla, el pedido igual quedó en el
    // boucher.
    crearPedidoDesdeResumen({ resumen: orderSummary, senderName, senderNumber })
        .catch(error => logger.error('No se pudo publicar en la pantalla de comandas:', error.message || error));
}

/** Normaliza texto para comparar palabras clave (minúsculas, sin acentos, espacios colapsados). */
function normalizeKeyword(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');
}

/** Devuelve 'pause' | 'resume' | 'status' si el texto es un comando admin, o null. */
function matchAdminCommand(text) {
    const ac = config.adminControl;
    if (!ac) return null;
    const t = normalizeKeyword(text);
    if (t === normalizeKeyword(ac.pauseKeyword)) return 'pause';
    if (t === normalizeKeyword(ac.resumeKeyword)) return 'resume';
    if (t === normalizeKeyword(ac.statusKeyword)) return 'status';
    return null;
}

/**
 * Procesa un comando del administrador (pausar/activar/estado) enviado por
 * WhatsApp. Devuelve true si el mensaje era un comando admin (y ya se atendió),
 * para que NO se procese como pedido de un cliente.
 */
async function tryAdminCommand({ text, from, zernio }) {
    const command = matchAdminCommand(text);
    if (!command) return false;

    // ── Autorización ──
    // Si hay números admin configurados, exigir que el remitente sea uno de
    // ellos (se comparan los últimos 10 dígitos para tolerar prefijos 57/+57).
    const admins = config.adminControl.adminNumbers || [];
    if (admins.length > 0) {
        const f = onlyDigits(from);
        const allowed = admins.some(a => a.slice(-10) === f.slice(-10));
        if (!allowed) {
            logger.warn(`🚫 Comando "${text}" de ${from} ignorado: número no autorizado.`);
            return false; // no es admin → sigue el flujo normal (cliente)
        }
    } else {
        logger.warn('⚠️ ADMIN_NUMBERS no está configurado: el comando se aceptó solo por palabra clave. Configura ADMIN_NUMBERS para mayor seguridad.');
    }

    let replyText;
    if (command === 'pause') {
        setPause(true);
        replyText = `⏸️ Bot PAUSADO. No responderá a los clientes hasta que envíes "${config.adminControl.resumeKeyword}".`;
    } else if (command === 'resume') {
        setPause(false);
        replyText = '▶️ Bot ACTIVADO. Ya está respondiendo a los clientes normalmente.';
    } else {
        replyText = isPaused()
            ? `📊 Estado: ⏸️ PAUSADO. Envía "${config.adminControl.resumeKeyword}" para reanudar.`
            : '📊 Estado: ▶️ ACTIVO, respondiendo normalmente.';
    }

    await sendWhatsAppMessage(from, replyText, zernio);
    logger.info(`🔧 Comando admin "${command}" de ${from}.`);
    return true;
}

/** ¿El mensaje del cliente es una confirmación corta? */
function isClientConfirming(text) {
    const { confirmationBlock } = config;
    if (!confirmationBlock) return false;
    const trimmed = text.trim();
    if (trimmed.length > confirmationBlock.maxLength) return false;
    // Quitar acentos para que "sí", "señor", "confirmó" también coincidan
    // (el \b de la regex no funciona bien con caracteres acentuados).
    const normalized = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return confirmationBlock.patterns.some(pattern => pattern.test(normalized));
}

// ── Buffer con callback de procesamiento ──
const messageBuffer = new MessageBuffer(config.debounceMs, processBuffer);

// ============================================================
// POST /webhook — Recepción de mensajes de Zernio
// ============================================================
router.post('/', validateWebhookPayload, async (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;
        logger.debug("📥 Datos recibidos en Webhook:", JSON.stringify(body, null, 2));

        // Estructura de Zernio:
        //   { event, message: { direction, text, sender: { phoneNumber, name } },
        //     conversation: { id, participantId, participantUsername }, account: { id } }
        const zMsg = (body?.message && typeof body.message === 'object' && !Array.isArray(body.message))
            ? body.message
            : null;

        // Solo procesar mensajes ENTRANTES reales. Ignorar salientes (evita que
        // el bot se responda a sí mismo) y eventos de estado (delivered/read/sent).
        const dir = String(zMsg?.direction || "").toLowerCase();
        if (!zMsg || dir !== "incoming") {
            logger.debug(`Webhook ignorado: evento "${body?.event}", direction "${dir}".`);
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
            logger.debug("Webhook ignorado: sin texto o número de remitente.");
            return;
        }

        // Datos necesarios para responder por Zernio (envío por conversación).
        const zConversationId = zMsg.conversationId || body?.conversation?.id;
        const zAccountId = body?.account?.id || body?.account?.accountId;
        const zernio = { conversationId: zConversationId, accountId: zAccountId };

        // ── Comando del administrador (pausar/activar/estado) ──
        if (await tryAdminCommand({ text: zText, from: zFrom, zernio })) {
            return;
        }

        logger.info(`💬 Fragmento de ${zName} (${zFrom}): ${zText}`);
        messageBuffer.add(zFrom, zText, {
            senderName: zName,
            zernioConversationId: zConversationId,
            zernioAccountId: zAccountId,
        });

    } catch (error) {
        logger.error("Error en webhook:", error.message || error);
    }
});

// ============================================================
// PROCESAMIENTO DIFERIDO
// ============================================================
async function processBuffer(senderNumber, fragments, meta) {
    const combinedText = fragments.join("\n");
    const { senderName, zernioConversationId, zernioAccountId } = meta;
    const zernio = { conversationId: zernioConversationId, accountId: zernioAccountId };
    const state = getUserState(senderNumber);

    // ── 0. Bot pausado por el administrador → no atender clientes ──
    if (isPaused()) {
        const reply = config.adminControl?.pausedCustomerReply;
        if (reply) {
            await sendWhatsAppMessage(senderNumber, reply, zernio);
        }
        logger.info(`⏸️ Bot pausado. Mensaje de ${senderName} (${senderNumber}) no procesado.`);
        return;
    }

    // ── 1. Cliente ya confirmó su pedido hoy → ignorar por completo ──
    if (state.confirmedDate === getBusinessDate()) {
        logger.info(`🔕 ${senderName} (${senderNumber}) ya confirmó hoy. Mensaje ignorado.`);
        return;
    }

    // ── 2. ¿Cliente confirma un pedido que YA tiene total mostrado? ──
    // Solo se toma como confirmación si hay un pedido pendiente (la IA ya
    // mostró el Total). Así, aclaraciones cortas como "Sí, la tradicional"
    // NO cierran el pedido en falso: siguen el flujo normal con la IA.
    if (state.pendingConfirmation && isClientConfirming(combinedText)) {
        const closing = config.confirmationBlock.closingMessage;
        logger.info(`✅ ${senderName} (${senderNumber}) confirmó. Enviando cierre y desactivando.`);
        await sendWhatsAppMessage(senderNumber, closing, zernio);
        chatHistory.add(senderNumber, combinedText, closing);
        state.pendingConfirmation = false;
        state.confirmedDate = getBusinessDate();

        // ── Boucher + pantalla de comandas (traza). No debe romper el cierre. ──
        try {
            await dispatchConfirmedOrder({ state, senderName, senderNumber });
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

    // ── ¿Pidió el menú? → la IA pone el marcador; respaldo por si lo olvida ──
    const { marker } = config.menuImages;
    const wantsMenu = aiReply.includes(marker) || /\b(menu|carta)\b/.test(normalizeKeyword(combinedText));
    const replyText = aiReply.split(marker).join('').trim();

    // ── Enviar al cliente: texto y, si aplica, las imágenes del menú ──
    if (replyText) {
        await sendWhatsAppMessage(senderNumber, replyText, zernio);
    }
    if (wantsMenu) {
        await sendMenuImages(senderNumber, zernio);
    }

    // ── Actualizar historial ──
    chatHistory.add(senderNumber, combinedText, replyText);

    // ── 4. ¿La IA mostró el resumen con Total? → guardar como "último pedido"
    //        y quedar a la espera de confirmación. La comanda a cocina se
    //        genera recién cuando el cliente confirma (paso 2). ──
    if (config.forwarding.detectMarkers.every(marker => aiReply.includes(marker))) {
        state.pendingConfirmation = true;
        state.lastOrderSummary = replyText;
        state.lastOrderAt = Date.now();
        logger.info(`⏳ ${senderName} (${senderNumber}) con pedido pendiente de confirmación.`);
    }
}

export default router;
