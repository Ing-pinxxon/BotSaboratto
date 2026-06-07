// ============================================================
// SERVER ENTRY POINT
// Arranca el servidor Express.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import config from '../config/bot.config.js';
import logger from './utils/logger.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    logger.info(`🚀 Bot de ${config.name} corriendo en el puerto ${PORT}`);
    logger.info(`${config.emoji} Timezone: ${config.timezone}`);
    logger.info(`📋 Endpoints: /webhook, /notify-payment, /health`);
});
