// ============================================================
// ESTADO GLOBAL DEL BOT (pausa manual del administrador)
// ------------------------------------------------------------
// El estado vive EN MEMORIA: si Railway reinicia o se despliega
// una versión nueva, el bot vuelve a quedar ACTIVO. Si lo tenías
// pausado y ves que volvió a responder, basta con enviar de nuevo
// la palabra clave de pausa.
// ============================================================

let botPaused = false;
let pausedAt = null;

/** ¿El bot está pausado globalmente? */
export function isPaused() {
    return botPaused;
}

/** Pausa o reanuda el bot. value=true pausa, value=false reanuda. */
export function setPause(value) {
    botPaused = !!value;
    pausedAt = botPaused ? new Date() : null;
    return { paused: botPaused, pausedAt };
}

/** Estado actual legible. */
export function getState() {
    return {
        paused: botPaused,
        pausedAt,
    };
}
