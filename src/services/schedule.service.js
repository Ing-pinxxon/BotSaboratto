// ============================================================
// SCHEDULE SERVICE
// Motor de horarios genérico que lee de bot.config.js.
// ============================================================

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../../config/bot.config.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Nombres de días en español ──
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// ── Cargar skills desde archivos Markdown ──
const SKILLS_DIR = join(__dirname, '..', '..', 'config', 'skills');

function loadSkill(filename) {
    try {
        return readFileSync(join(SKILLS_DIR, filename), 'utf-8');
    } catch (error) {
        logger.error(`No se pudo cargar el skill "${filename}":`, error.message);
        return '';
    }
}

const openSkill = loadSkill('open.md');
const closedSkill = loadSkill('closed.md');

/**
 * Determina si el negocio está abierto y devuelve la instrucción apropiada.
 *
 * @returns {{ instruction: string, type: 'OPEN' | 'CLOSED' }}
 */
export function getBusinessContext() {
    const { dayIndex, currentTime } = getLocalNow();
    const dayKey = DAY_NAMES[dayIndex];

    const schedule = config.schedule[dayKey];

    let isOpen = false;

    if (schedule) {
        const [openHour, closeHour] = schedule;
        isOpen = currentTime >= openHour && currentTime < closeHour;
    }

    if (isOpen) {
        // Promo martes a jueves: combo de Hamburguesa Tradicional a $15.900.
        const promoActiva = dayIndex >= 2 && dayIndex <= 4; // 2=mar, 3=mié, 4=jue
        const promoTexto = promoActiva
            ? '🔥 PROMO ACTIVA HOY (martes a jueves): el **Combo de Hamburguesa Tradicional** cuesta **$15.900** (NO $17.500). '
              + 'Este precio REEMPLAZA cualquier otro para ese combo hoy; los ejemplos de abajo con $17.500 NO aplican hoy. '
              + 'Aplica SOLO al combo de la hamburguesa tradicional; los demás combos y productos mantienen su precio normal. '
              + 'El domicilio ($1.000) se suma aparte solo si es a domicilio.'
            : '';
        // Sin esto el modelo no sabe que ya abrimos y copia avisos de
        // "cerrado" que quedaron en el historial del chat.
        const estadoTexto = `🟢 ESTADO ACTUAL: ABIERTO. Hoy es ${DAY_NAMES_ES[dayIndex]} y son las ${formatHour(currentTime)} (hora Colombia). `
            + 'Estamos atendiendo y recibiendo pedidos AHORA. Si el cliente pregunta si estamos abiertos o atendiendo, responde que SÍ y que ya puede hacer su pedido. '
            + 'Si en mensajes anteriores del chat se dijo que estábamos cerrados, eso YA NO aplica: NUNCA digas que estamos cerrados.';
        const instruction = openSkill
            .replace(/\[ESTADO_ACTUAL\]/g, estadoTexto)
            .replace(/\[PROMO_DIA\]/g, promoTexto);
        return { instruction, type: 'OPEN' };
    }

    // ── Calcular próxima apertura ──
    const nextOpening = findNextOpening(dayIndex, currentTime);

    let instruction = closedSkill;
    instruction = instruction.replace(/\[PROXIMO_DIA\]/g, nextOpening.dia);
    instruction = instruction.replace(/\[PROXIMA_HORA\]/g, nextOpening.hora);

    return { instruction, type: 'CLOSED' };
}

/**
 * Día (0=Dom … 6=Sáb) y hora decimal actuales en la zona horaria del negocio.
 * Se leen las partes con Intl en vez de re-parsear un string de fecha, que
 * depende del formato de cada versión de Node/ICU.
 */
function getLocalNow() {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: config.timezone,
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric',
            hourCycle: 'h23',
        }).formatToParts(new Date()).map(p => [p.type, p.value])
    );
    const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const currentTime = Number(parts.hour) + Number(parts.minute) / 60;
    return { dayIndex, currentTime };
}

/**
 * Busca el próximo día y hora de apertura.
 *
 * @param {number} currentDayIndex - Día actual (0-6)
 * @param {number} currentTime     - Hora actual en decimal
 * @returns {{ dia: string, hora: string }}
 */
function findNextOpening(currentDayIndex, currentTime) {
    // Primero: ¿abre más tarde HOY?
    const todayKey = DAY_NAMES[currentDayIndex];
    const todaySchedule = config.schedule[todayKey];
    if (todaySchedule) {
        const [openHour] = todaySchedule;
        if (currentTime < openHour) {
            return {
                dia: 'hoy',
                hora: formatHour(openHour),
            };
        }
    }

    // Buscar en los próximos 7 días
    for (let offset = 1; offset <= 7; offset++) {
        const nextDayIndex = (currentDayIndex + offset) % 7;
        const nextDayKey = DAY_NAMES[nextDayIndex];
        const nextSchedule = config.schedule[nextDayKey];

        if (nextSchedule) {
            const [openHour] = nextSchedule;
            const dayLabel = offset === 1
                ? `mañana ${DAY_NAMES_ES[nextDayIndex]}`
                : `el ${DAY_NAMES_ES[nextDayIndex]}`;
            return {
                dia: dayLabel,
                hora: formatHour(openHour),
            };
        }
    }

    return { dia: 'próximamente', hora: '' };
}

/**
 * Formatea una hora decimal a formato legible.
 * Ej: 18 → "6:00 p.m.", 19.5 → "7:30 p.m."
 */
function formatHour(decimalHour) {
    const hours24 = Math.floor(decimalHour);
    const minutes = Math.round((decimalHour - hours24) * 60);
    const hours12 = hours24 % 12 || 12;
    const period = hours24 >= 12 ? 'p.m.' : 'a.m.';
    const minuteStr = minutes.toString().padStart(2, '0');
    return `${hours12}:${minuteStr} ${period}`;
}
