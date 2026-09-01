// ============================================================
// HOOKS DE PEDIDO CONFIRMADO
// Construye la comanda de cocina y extrae los datos del pedido
// a partir del último resumen que la IA le mostró al cliente.
// Cada negocio puede modificar este archivo sin tocar el core.
// ============================================================

import config from './bot.config.js';

/**
 * Limpia el resumen de la IA para dejar solo el cuerpo del pedido:
 * quita el saludo inicial ("Listo 😎 te confirmo:"), la pregunta final
 * ("¿Me confirmas? ✅") y los asteriscos de negrita alrededor del Total.
 *
 * @param {string} orderSummary - Último mensaje de la IA con el pedido
 * @returns {string} Cuerpo limpio (items + subtotal/icopor/domicilio + total)
 */
function cleanSummary(orderSummary) {
    return (orderSummary || '')
        .replace(/^.*te confirmo:?\s*/is, '')       // quita saludo + "te confirmo:"
        .replace(/¿\s*me confirmas\??\s*✅?.*$/is, '') // quita la pregunta final
        .replace(/\*\*/g, '')                          // quita negritas markdown
        .trim();
}

/**
 * Extrae solo las líneas de productos del resumen (para la columna Items).
 * @param {string} orderSummary
 * @returns {string}
 */
export function extractItems(orderSummary) {
    const body = cleanSummary(orderSummary);
    const stop = /^(subtotal|icopor|domicilio|total)\b/i;
    const lines = [];
    for (const line of body.split('\n')) {
        if (stop.test(line.trim())) break;
        if (line.trim()) lines.push(line.trim());
    }
    return lines.join('\n');
}

/**
 * Extrae los montos del resumen. El Total casi siempre está presente;
 * subtotal/icopor/domicilio son opcionales. Devuelve enteros (COP) o null.
 * @param {string} orderSummary
 * @returns {{subtotal:number|null, icopor:number|null, domicilio:number|null, total:number|null}}
 */
export function parseOrderAmounts(orderSummary) {
    const text = orderSummary || '';
    const grab = (label) => {
        // Anclado al inicio de línea (con posibles ** de negrita) para que
        // "Total" no haga match dentro de "Subtotal".
        const m = text.match(new RegExp(`^\\s*\\*{0,2}${label}\\b[^\\d]*([\\d.,]+)`, 'im'));
        if (!m) return null;
        const digits = m[1].replace(/[^\d]/g, ''); // "$46.500" → "46500"
        return digits ? parseInt(digits, 10) : null;
    };
    return {
        subtotal: grab('Subtotal'),
        icopor: grab('Icopor'),
        domicilio: grab('Domicilio'),
        total: grab('Total'),
    };
}

/**
 * Construye la comanda de cocina lista para enviar por WhatsApp (1:1)
 * y/o imprimir. Reutilizable por una futura integración de impresora.
 *
 * @param {object} params
 * @param {string} params.orderSummary  - Último resumen de la IA con el pedido
 * @param {string} params.senderName    - Nombre del cliente
 * @param {string} params.senderNumber  - Número del cliente
 * @param {number} params.orderNumber   - Consecutivo diario del pedido
 * @returns {string} Comanda formateada
 */
export function buildKitchenComanda({ orderSummary, senderName, senderNumber, orderNumber }) {
    const now = new Date();
    const date = now.toLocaleDateString('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: config.timezone,
    });
    const time = now.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.timezone,
    });

    const body = cleanSummary(orderSummary);
    const num = orderNumber != null ? `#${orderNumber} ` : '';

    return `👨‍🍳 *COMANDA ${num}— ${config.name.toUpperCase()}* ${config.emoji}
━━━━━━━━━━━━━━━━━━━━
👤 *${senderName}*   📱 ${senderNumber}
📅 ${date}   🕒 ${time}
━━━━━━━━━━━━━━━━━━━━
${body}
━━━━━━━━━━━━━━━━━━━━
✅ CONFIRMADO`;
}
