// ============================================================
// MIDDLEWARE: SEGURIDAD BÁSICA
// ============================================================

/**
 * Agrega headers de seguridad básicos.
 * Alternativa liviana a helmet para no agregar dependencias.
 */
export function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.removeHeader('X-Powered-By');
    next();
}
