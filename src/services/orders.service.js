// ============================================================
// ORDERS SERVICE (BOUCHER / TRAZA)
// Persiste cada pedido confirmado en dos destinos:
//   1) CSV local (siempre) → traza durable, offline, base para impresora.
//   2) Google Sheets (si está configurado) → hoja de cálculo en la nube
//      para análisis y decisiones. Se degrada con gracia si falta config
//      o falla la API: nunca lanza al flujo de mensajes.
// ============================================================

import { mkdirSync, existsSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../../config/bot.config.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// Encabezados/columnas del boucher (mismo orden en CSV y en Sheets).
const HEADERS = [
    'Fecha', 'Hora', 'N', 'Cliente', 'Numero',
    'Items', 'Subtotal', 'Icopor', 'Domicilio', 'Total', 'DiaSemana',
];

// ── Consecutivo diario en memoria ──
const dailyCounter = { date: null, n: 0 };

/**
 * Devuelve el siguiente número de pedido para la fecha de negocio dada.
 * Se reinicia automáticamente cuando cambia el día.
 * @param {string} businessDate - Fecha 'YYYY-MM-DD' de negocio
 * @returns {number}
 */
export function nextOrderNumber(businessDate) {
    if (dailyCounter.date !== businessDate) {
        dailyCounter.date = businessDate;
        dailyCounter.n = 0;
    }
    dailyCounter.n += 1;
    return dailyCounter.n;
}

/**
 * Persiste un pedido confirmado (CSV local + Google Sheets si aplica).
 * @param {object} record
 * @returns {Promise<void>}
 */
export async function saveOrder(record) {
    const row = toRow(record);

    // 1) CSV local (siempre). Es la traza que nunca se pierde.
    try {
        appendToCsv(row);
    } catch (error) {
        logger.error('No se pudo guardar el pedido en CSV local:', error.message || error);
    }

    // 2) Google Sheets (nube), solo si está configurado.
    if (config.orders?.sheetId) {
        try {
            await appendToSheet(row);
        } catch (error) {
            logger.error('No se pudo guardar el pedido en Google Sheets:', error.message || error);
        }
    }
}

/** Normaliza un record a un objeto plano con las columnas de HEADERS. */
function toRow(record) {
    return {
        Fecha: record.businessDate || '',
        Hora: record.time || '',
        N: record.orderNumber ?? '',
        Cliente: record.senderName || '',
        Numero: record.senderNumber || '',
        // Aplanar saltos de línea de los items para una celda limpia.
        Items: (record.items || '').replace(/\s*\n+\s*/g, ' | ').trim(),
        Subtotal: record.subtotal ?? '',
        Icopor: record.icopor ?? '',
        Domicilio: record.domicilio ?? '',
        Total: record.total ?? '',
        DiaSemana: record.diaSemana || '',
    };
}

// ── CSV local ──────────────────────────────────────────────

function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function appendToCsv(row) {
    const relPath = config.orders?.csvPath || 'data/pedidos.csv';
    const filePath = join(PROJECT_ROOT, relPath);

    mkdirSync(dirname(filePath), { recursive: true });

    const isNew = !existsSync(filePath);
    let content = '';
    if (isNew) {
        content += HEADERS.join(',') + '\n';
    }
    content += HEADERS.map(h => csvEscape(row[h])).join(',') + '\n';

    appendFileSync(filePath, content, 'utf-8');
    logger.info(`🧾 Boucher guardado en ${relPath} (pedido #${row.N} - ${row.Cliente})`);
}

// ── Google Sheets (carga perezosa + caché) ─────────────────

let cachedSheet = null;

async function getSheet() {
    if (cachedSheet) return cachedSheet;

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY;
    if (!email || !key) {
        throw new Error('Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
    }

    // Import perezoso: si las dependencias no están instaladas, no rompe el CSV.
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const { JWT } = await import('google-auth-library');

    const jwt = new JWT({
        email,
        key: key.replace(/\\n/g, '\n'), // soporta clave en una sola línea en .env
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(config.orders.sheetId, jwt);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];

    // Asegurar que exista la fila de encabezados que addRow() necesita.
    try {
        await sheet.loadHeaderRow();
        if (!sheet.headerValues || sheet.headerValues.length === 0) {
            await sheet.setHeaderRow(HEADERS);
        }
    } catch {
        await sheet.setHeaderRow(HEADERS);
    }

    cachedSheet = sheet;
    return sheet;
}

async function appendToSheet(row) {
    const sheet = await getSheet();
    await sheet.addRow(row);
    logger.info(`☁️  Boucher enviado a Google Sheets (pedido #${row.N} - ${row.Cliente})`);
}
