// ============================================================
// HOOKS POST-RESPUESTA
// Personaliza el comportamiento después de que la IA responde.
// Cada negocio puede modificar este archivo sin tocar el core.
// ============================================================

import config from './bot.config.js';

/**
 * Determina si la respuesta de la IA debe ser reenviada
 * al número de confirmación (forwarding).
 *
 * @param {object} params
 * @param {string} params.aiReply      - Respuesta generada por la IA
 * @param {string} params.userMessage  - Mensaje original del cliente
 * @returns {boolean}
 */
export function shouldForward({ aiReply, userMessage }) {
    const { forwarding } = config;
    if (!forwarding) return false;

    // Verificar que la respuesta contiene los marcadores de detección
    const hasMarkers = forwarding.detectMarkers.every(
        marker => aiReply.includes(marker)
    );

    // Verificar que el mensaje del cliente NO es solo una confirmación
    const isJustConfirmation = forwarding.ignorePatterns.some(
        pattern => pattern.test(userMessage.trim())
    );

    return hasMarkers && !isJustConfirmation;
}

/**
 * Construye el mensaje de reenvío de confirmación.
 * Personaliza el formato según las necesidades del negocio.
 *
 * @param {object} params
 * @param {string} params.aiReply      - Respuesta de la IA
 * @param {string} params.senderName   - Nombre del cliente
 * @param {string} params.senderNumber - Número del cliente
 * @returns {string} Mensaje formateado para reenviar
 */
export function buildForwardMessage({ aiReply, senderName, senderNumber }) {
    const time = new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: config.timezone,
    });

    // Intentar extraer el detalle del pedido/servicio
    const detailMatch = aiReply.match(
        /te confirmo:([\s\S]+?)(Subtotal|Icopor|Domicilio|\*\*Total)/i
    );
    const detail = detailMatch ? detailMatch[1].trim() : aiReply;

    return `${config.emoji} *NUEVA CONFIRMACIÓN - ${config.name.toUpperCase()}*
---------------------------
👤 *Cliente:* ${senderName}
📱 *Número:* ${senderNumber}
🕒 *Hora:* ${time}

📝 *DETALLE:*
${detail}
---------------------------
💰 *VER RESUMEN COMPLETO EN EL CHAT*`;
}
