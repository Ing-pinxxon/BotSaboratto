// ============================================================
// MESSAGE BUFFER (DEBOUNCE)
// Acumula fragmentos de mensajes y los procesa tras un silencio.
// ============================================================

import logger from './logger.js';

export class MessageBuffer {
    /**
     * @param {number} debounceMs - Milisegundos de silencio antes de procesar
     * @param {function} onFlush  - Callback: (senderNumber, fragments, meta) => Promise
     */
    constructor(debounceMs, onFlush) {
        this.debounceMs = debounceMs;
        this.onFlush = onFlush;
        this.buffers = {};    // { [senderNumber]: string[] }
        this.timers = {};     // { [senderNumber]: NodeJS.Timeout }
        this.meta = {};       // { [senderNumber]: { senderName, phoneNumberId } }
    }

    /**
     * Agrega un fragmento al buffer de un usuario.
     * Reinicia el timer de debounce.
     */
    add(senderNumber, text, meta = {}) {
        if (!this.buffers[senderNumber]) {
            this.buffers[senderNumber] = [];
        }

        this.buffers[senderNumber].push(text);
        this.meta[senderNumber] = { ...this.meta[senderNumber], ...meta };

        // Reiniciar timer
        clearTimeout(this.timers[senderNumber]);
        this.timers[senderNumber] = setTimeout(
            () => this._flush(senderNumber),
            this.debounceMs,
        );
    }

    /**
     * Procesa el buffer acumulado de un usuario.
     * @private
     */
    async _flush(senderNumber) {
        const fragments = this.buffers[senderNumber]?.splice(0) || [];
        if (!fragments.length) return;

        const meta = this.meta[senderNumber] || {};

        logger.info(`\n⏱️  Procesando buffer de ${meta.senderName || 'desconocido'} (${senderNumber}):`);
        logger.info(`   ${fragments.length} fragmento(s) → "${fragments.join(' | ')}"`);

        try {
            await this.onFlush(senderNumber, fragments, meta);
        } catch (error) {
            logger.error('Error procesando buffer:', error.message || error);
        }
    }
}
