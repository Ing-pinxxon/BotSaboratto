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

    // ── Detección de confirmación para reenvío ──
    // El bot reenvía al número de forwarding cuando la respuesta
    // de la IA contiene TODOS estos marcadores:
    forwarding: {
        detectMarkers: ["**Total:**"],  // Marcadores en la respuesta de IA
        ignorePatterns: [               // Si el mensaje del cliente tiene esto, NO reenviar
            /gracias/i, /ok/i, /listo/i, /perfecto/i, /👍/, /si/i, /confirmado/i,
        ],
    },
};
