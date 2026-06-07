// ============================================================
// LOGGER ESTRUCTURADO
// Mantiene los emojis para legibilidad pero agrega estructura.
// ============================================================

import config from '../../config/bot.config.js';

const PREFIX = `[${config.name}]`;

const logger = {
    info: (...args) => console.log(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, '⚠️', ...args),
    error: (...args) => console.error(PREFIX, '❌', ...args),
    debug: (...args) => {
        if (process.env.DEBUG === 'true') {
            console.log(PREFIX, '🐛', ...args);
        }
    },
};

export default logger;
