// ============================================================
// CHAT HISTORY MANAGER
// Gestiona el historial de conversación por usuario.
// ============================================================

export class ChatHistory {
    /**
     * @param {number} maxEntries - Máximo de entradas en el historial
     */
    constructor(maxEntries = 60) {
        this.maxEntries = maxEntries;
        this.histories = {};  // { [senderNumber]: Array }
    }

    /**
     * Obtiene el historial de un usuario.
     * @param {string} senderNumber
     * @returns {Array}
     */
    get(senderNumber) {
        if (!this.histories[senderNumber]) {
            this.histories[senderNumber] = [];
        }
        return this.histories[senderNumber];
    }

    /**
     * Agrega un par usuario-modelo al historial.
     * Recorta si excede el máximo.
     * @param {string} senderNumber
     * @param {string} userText
     * @param {string} modelText
     */
    add(senderNumber, userText, modelText) {
        const history = this.get(senderNumber);
        history.push({ role: "user", parts: [{ text: userText }] });
        history.push({ role: "model", parts: [{ text: modelText }] });

        // Recortar de a pares (siempre quitar el par más antiguo)
        while (history.length > this.maxEntries) {
            history.splice(0, 2);
        }
    }

    /**
     * Limpia el historial de un usuario.
     * @param {string} senderNumber
     */
    clear(senderNumber) {
        this.histories[senderNumber] = [];
    }
}
