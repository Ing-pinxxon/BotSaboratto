// ============================================================
// AI SERVICE (GEMINI)
// Genera respuestas usando Google Gemini.
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import logger from '../utils/logger.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Genera una respuesta de IA usando Gemini.
 *
 * @param {string} prompt            - Mensaje del usuario
 * @param {string} systemInstruction - Instrucción del sistema (skill)
 * @param {Array}  history           - Historial de conversación
 * @returns {Promise<string>}        - Respuesta generada
 */
export async function generateResponse(prompt, systemInstruction = "", history = []) {
    try {
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
            systemInstruction: systemInstruction,
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        logger.error("--- DETALLE DEL ERROR GEMINI ---");
        logger.error("Status:", error.status);
        logger.error("Mensaje:", error.message);
        throw error;
    }
}
