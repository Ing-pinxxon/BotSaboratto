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
    const colombiaTime = new Date().toLocaleString("en-US", {
        timeZone: config.timezone,
    });
    const now = new Date(colombiaTime);

    const dayIndex = now.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
    const currentTime = now.getHours() + (now.getMinutes() / 60);
    const dayKey = DAY_NAMES[dayIndex];

    const schedule = config.schedule[dayKey];

    let isOpen = false;

    if (schedule) {
        const [openHour, closeHour] = schedule;
        isOpen = currentTime >= openHour && currentTime < closeHour;
    }

    if (isOpen) {
        return { instruction: openSkill, type: 'OPEN' };
    }

    // ── Calcular próxima apertura ──
    const nextOpening = findNextOpening(dayIndex, currentTime);

    let instruction = closedSkill;
    instruction = instruction.replace(/\[PROXIMO_DIA\]/g, nextOpening.dia);
    instruction = instruction.replace(/\[PROXIMA_HORA\]/g, nextOpening.hora);

    return { instruction, type: 'CLOSED' };
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
    const hours12 = hours24 > 12 ? hours24 - 12 : hours24;
    const period = hours24 >= 12 ? 'p.m.' : 'a.m.';
    const minuteStr = minutes.toString().padStart(2, '0');
    return `${hours12}:${minuteStr} ${period}`;
}
