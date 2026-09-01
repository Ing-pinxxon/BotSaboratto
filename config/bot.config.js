// ============================================================
// CONFIGURACIÓN DEL NEGOCIO
// Este archivo es lo ÚNICO que cambias para un nuevo negocio.
// ============================================================

export default {
    // ── Identidad ──
    name: "Saboratto",
    emoji: "🍔",
    contactNumber: "322 243 0079",

    // ── Zona horaria ──
    timezone: "America/Bogota",

    // ── Comportamiento del bot ──
    debounceMs: 10000,      // Espera de silencio antes de responder (ms)
    maxHistory: 60,          // Máximo de entradas en historial (30 pares)

    // ── Horarios de atención ──
    // Formato: [horaApertura, horaCierre] o null = cerrado
    // Horas en formato 24h decimal (ej. 18.5 = 6:30 PM)
    schedule: {
        sunday:    [18, 22.5],    // 6:00 PM - 10:30 PM (cierre público 11 PM)
        monday:    null,           // Cerrado
        tuesday:   [19, 21.5],    // 7:00 PM - 9:30 PM  (cierre público 10 PM)
        wednesday: [19, 21.5],
        thursday:  [19, 21.5],
        friday:    [18, 22.5],    // 6:00 PM - 10:30 PM
        saturday:  [18, 22.5],
        // earlyCloseMinutes ya está implícito en los horarios de arriba
        // (el horario público de Saboratto cierra 30 min después del bot)
    },

    // ── Datos de pago ──
    payment: {
        methods: ["Bre-B", "Nequi", "Daviplata"],
        key: "0091675012",
        holder: "Daniel Felipe Pinzón Rodríguez",
    },

    // ── Números de notificación ──
    // Estos se leen de variables de entorno para seguridad.
    // Si no existen en .env, quedan null y no se envían notificaciones.
    notifications: {
        // Número al que se reenvían confirmaciones (antes "cocina")
        forwarding: process.env.KITCHEN_NUMBER || null,
        // Número al que se notifican pagos
        payments: process.env.BOLD_NOTIFY_NUMBER || null,
    },

    // ── Detección del resumen de pedido ──
    // El bot considera que la IA mostró un pedido con total cuando la
    // respuesta contiene TODOS estos marcadores. Ese resumen se guarda
    // y se envía a cocina en el momento en que el cliente confirma.
    forwarding: {
        detectMarkers: ["Total:"],  // Marcadores en la respuesta de IA
    },

    // ── Guardado de pedidos (boucher / traza) ──
    // Cada pedido confirmado se guarda SIEMPRE en un CSV local y, si
    // GOOGLE_SHEET_ID está configurado, también en una hoja de cálculo
    // en la nube (Google Sheets) para análisis y decisiones.
    orders: {
        csvPath: 'data/pedidos.csv',
        sheetId: process.env.GOOGLE_SHEET_ID || null,
    },

    // ── Cierre y desactivación tras confirmación ──
    // Cuando la IA ya mostró el resumen con **Total:** y el cliente
    // confirma (mensaje corto con alguna de estas palabras), el bot
    // envía un mensaje de cierre y se desactiva para ese cliente por
    // el resto del día (se reactiva automáticamente al día siguiente).
    confirmationBlock: {
        // El mensaje del cliente debe ser corto (<= maxLength) y contener
        // alguna de estas palabras para considerarse una confirmación.
        maxLength: 30,
        patterns: [
            /\b(ok|okay|okey|oka|listo|confirmo|confirmad[oa]|dale|de una|va|s[ií]|s[ií] se[ñn]or|perfecto|gracias)\b/i,
        ],
        // Mensaje que se envía al cliente justo antes de desactivar.
        closingMessage: "✅ ¡Tu pedido ha sido confirmado! En unos minutos te damos el tiempo de espera. ¡Gracias por preferirnos! 🍔",
    },
};
