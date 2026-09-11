// ============================================================
// COMANDAS SERVICE
// Envía a la app de comandas (Supabase) los pedidos que el bot
// cerró por WhatsApp, para que aparezcan solos en la pantalla
// de cocina marcados como "sin revisar".
//
// Variables de entorno necesarias:
//   COMANDAS_SUPABASE_URL          → https://xxxx.supabase.co
//   COMANDAS_SERVICE_KEY           → service_role key del proyecto
// Si faltan, el bot sigue funcionando igual y solo registra un aviso.
// ============================================================

import axios from 'axios';
import dotenv from 'dotenv';
import config from '../../config/bot.config.js';
import { generateResponse } from './ai.service.js';
import logger from '../utils/logger.js';

dotenv.config();

const SUPABASE_URL = process.env.COMANDAS_SUPABASE_URL;
const SERVICE_KEY = process.env.COMANDAS_SERVICE_KEY;

/** ¿Está configurada la conexión con la app de comandas? */
export function comandasHabilitado() {
    return Boolean(SUPABASE_URL && SERVICE_KEY);
}

const api = () => axios.create({
    baseURL: `${SUPABASE_URL}/rest/v1`,
    timeout: 15000,
    headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
    },
});

// ── Catálogo en memoria (se refresca cada 10 minutos) ──
let catalogoCache = null;
let catalogoExpira = 0;

/** Lee productos y categorías de la app de comandas. */
async function obtenerCatalogo() {
    if (catalogoCache && Date.now() < catalogoExpira) return catalogoCache;

    const [productos, categorias] = await Promise.all([
        api().get('/productos', { params: { select: 'id,nombre,precio,precio_combo,categoria_id,activo,ingredientes', activo: 'eq.true' } }),
        api().get('/categorias', { params: { select: 'id,nombre,lleva_icopor,permite_combo' } }),
    ]);

    const porId = new Map(categorias.data.map(c => [c.id, c]));
    catalogoCache = productos.data.map(p => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        precio_combo: p.precio_combo,
        categoria: porId.get(p.categoria_id)?.nombre ?? 'Adicionales',
        permite_combo: porId.get(p.categoria_id)?.permite_combo ?? false,
        ingredientes: Array.isArray(p.ingredientes) ? p.ingredientes : [],
    }));
    catalogoExpira = Date.now() + 10 * 60 * 1000;
    logger.info(`📋 Catálogo de comandas cargado: ${catalogoCache.length} productos`);
    return catalogoCache;
}

/**
 * Convierte el resumen en texto que escribió la IA en una lista de
 * productos. Se le pide a Gemini que haga la traducción eligiendo
 * únicamente nombres que existan en el menú real.
 */
export async function extraerItems(resumen, catalogo) {
    const menu = catalogo
        .map(p => {
            const combo = p.precio_combo ? ` | combo $${p.precio_combo}` : '';
            const ing = p.ingredientes?.length ? ` | ingredientes: ${p.ingredientes.join(', ')}` : '';
            return `- ${p.nombre} | ${p.categoria} | $${p.precio}${combo}${ing}`;
        })
        .join('\n');

    const instruccion = `Eres un conversor de pedidos a datos. Recibes el resumen de un pedido escrito en lenguaje natural y devuelves SOLO un objeto JSON válido, sin texto adicional, sin markdown y sin bloques de código.

MENÚ REAL (usa EXACTAMENTE estos nombres):
${menu}

Formato de salida:
{
  "items": [
    {
      "nombre": "nombre exacto del menú de arriba",
      "cantidad": 1,
      "es_combo": false,
      "exclusiones": ["Cebolla Saboratto"],
      "nota": null
    }
  ],
  "es_domicilio": true,
  "metodo_pago": "efectivo"
}

REGLAS:
1. "nombre" debe coincidir EXACTAMENTE con un nombre del menú. Si el resumen menciona algo que no está en el menú, úsalo tal cual como aparece y marca ese item con "fuera_de_menu": true y "precio": <precio que indique el resumen>.
2. Si el resumen agrupa productos (ej. "3 Hamburguesas" con subrenglones "2 rancheras, 1 tradicional"), sepáralos en items distintos con su cantidad real.
3. "es_combo" es true solo si el resumen dice explícitamente "combo".
4. "exclusiones" son los ingredientes que el cliente pidió quitar (lo que aparece tras "sin"). Escríbelos EXACTAMENTE como aparecen en la lista de "ingredientes" de ese producto en el menú de arriba: si el cliente dice "sin cebolla" y el ingrediente se llama "Cebolla Saboratto", debes escribir "Cebolla Saboratto". Si no hay, usa [].
5. "nota" son aclaraciones sin costo que no sean exclusiones (ej. "bien asada"). Si no hay, usa null.
6. NO incluyas el domicilio ni el icopor como items: se calculan aparte.
7. "es_domicilio" es false solo si el resumen dice que el cliente recoge o que no es domicilio.
8. "metodo_pago" debe ser uno de: efectivo, nequi, daviplata, breb, otro. Si no se menciona, usa "efectivo".`;

    const bruto = await generateResponse(resumen, instruccion, []);
    const limpio = bruto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin === -1) throw new Error(`La IA no devolvió JSON: ${bruto.slice(0, 200)}`);

    const datos = JSON.parse(limpio.slice(inicio, fin + 1));
    if (!Array.isArray(datos.items) || datos.items.length === 0) {
        throw new Error('La IA no devolvió ningún producto');
    }
    return datos;
}

/**
 * Ajusta lo que devolvió la IA contra el catálogo real: el precio SIEMPRE
 * sale de la base de datos, nunca de lo que la IA haya calculado.
 */
export function normalizarItems(items, catalogo) {
    const porNombre = new Map(catalogo.map(p => [p.nombre.toLowerCase(), p]));

    return items.map(item => {
        const nombre = String(item.nombre || '').trim();
        const producto = porNombre.get(nombre.toLowerCase());
        const cantidad = Math.max(1, parseInt(item.cantidad, 10) || 1);
        const exclusiones = Array.isArray(item.exclusiones) ? item.exclusiones.filter(Boolean).map(String) : [];
        const nota = item.nota ? String(item.nota).trim() : null;

        if (!producto) {
            // Algo que no está en el menú: entra como producto libre con el precio que dijo el resumen
            const precio = Math.max(0, parseInt(item.precio, 10) || 0);
            logger.warn(`⚠️ "${nombre}" no está en el menú; se registra como producto fuera de menú ($${precio})`);
            return {
                producto_id: null,
                nombre,
                categoria_nombre: 'Adicionales',
                precio_unitario: precio,
                cantidad,
                es_combo: false,
                exclusiones,
                nota,
                es_personalizado: true,
            };
        }

        const esCombo = Boolean(item.es_combo) && producto.permite_combo;
        return {
            producto_id: producto.id,
            nombre: producto.nombre,
            categoria_nombre: producto.categoria,
            precio_unitario: esCombo ? (producto.precio_combo ?? producto.precio) : producto.precio,
            cantidad,
            es_combo: esCombo,
            exclusiones,
            nota,
            es_personalizado: false,
        };
    });
}

const METODOS_VALIDOS = ['efectivo', 'nequi', 'daviplata', 'breb', 'otro'];

/**
 * Crea el pedido en la app de comandas a partir del resumen del bot.
 *
 * @param {object} params
 * @param {string} params.resumen      - Texto del resumen que generó la IA
 * @param {string} params.senderName   - Nombre del cliente en WhatsApp
 * @param {string} params.senderNumber - Número del cliente
 * @returns {Promise<number|null>}     - id del pedido creado, o null si no se pudo
 */
export async function crearPedidoDesdeResumen({ resumen, senderName, senderNumber }) {
    if (!comandasHabilitado()) {
        logger.debug('Comandas no configurado (faltan COMANDAS_SUPABASE_URL / COMANDAS_SERVICE_KEY)');
        return null;
    }

    try {
        const catalogo = await obtenerCatalogo();
        const datos = await extraerItems(resumen, catalogo);
        const items = normalizarItems(datos.items, catalogo);

        const metodo = METODOS_VALIDOS.includes(datos.metodo_pago) ? datos.metodo_pago : 'efectivo';

        const cuerpo = {
            p_pedido: {
                cliente_nombre: (senderName || 'Cliente WhatsApp').trim(),
                cliente_telefono: String(senderNumber || '').replace(/\D/g, ''),
                metodo_pago: metodo,
                es_domicilio: datos.es_domicilio !== false,
                notas: null,
                origen: 'whatsapp',
                revisado: false,          // el personal debe aprobarlo en la pantalla
                texto_original: resumen,  // queda guardado para poder comparar
            },
            p_items: items,
        };

        const { data } = await api().post('/rpc/guardar_pedido', cuerpo);
        const id = Number(data);
        logger.info(`🧾 Pedido #${id} enviado a la pantalla de comandas (${items.length} productos, sin revisar)`);
        return id;
    } catch (error) {
        const detalle = error.response?.data?.message || error.response?.data || error.message;
        logger.error('❌ No se pudo crear el pedido en comandas:', detalle);
        // Nunca interrumpe la conversación con el cliente: el bot sigue igual
        // y el pedido llega de todos modos por WhatsApp al número de cocina.
        return null;
    }
}

export default { crearPedidoDesdeResumen, comandasHabilitado };
