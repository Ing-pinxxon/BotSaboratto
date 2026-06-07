# 🍔 Saboratto AI Bot (Kapso + Google Gemini)

Este proyecto es un bot inteligente para WhatsApp diseñado para **Saboratto**, un negocio de comidas rápidas. Funciona integrando **Kapso** (como puente y proveedor del webhook de WhatsApp) y la API de **Google Gemini** para dotar al bot de inteligencia artificial conversacional.

El bot no solo responde preguntas, sino que está entrenado para tomar pedidos complejos, sumar precios, cobrar adicionales (como icopor o papas) y enviar un resumen limpio directamente al WhatsApp de la cocina.

## ✨ Características Principales

* **🤖 Inteligencia Artificial:** Usa `gemini-2.5-flash-lite` (o versiones superiores) para comprender lenguaje natural, lidiar con audios transcritos por Kapso y atender a los clientes de forma empática.
* **🕒 Horarios Dinámicos:** Cambia su comportamiento automáticamente (zona horaria `America/Bogota`).
  * *Modo Abierto:* Toma pedidos y calcula totales.
  * *Modo Cerrado:* Brinda información del menú y responde preguntas sobre ubicación, pero se niega educadamente a tomar pedidos, avisando la hora de apertura.
  * *Cierre Preventivo:* La lógica interna cierra el bot 30 minutos antes del horario oficial de cierre al público para evitar pedidos de última hora en cocina.
* **⏳ Buffer Anti-Spam (Debounce):** Si el cliente manda 5 mensajes separados por palabra (ej. "Hola", "quiero", "una", "hamburguesa"), el bot los acumula en un buffer durante 10 segundos antes de procesarlos como un solo pedido.
* **👨‍🍳 Integración con Cocina:** Cuando el bot confirma un pedido exitoso ("¿Me confirmas? ✅" y el cliente dice "Sí"), extrae el resumen del pedido y se lo reenvía automáticamente al número de WhatsApp de la cocina.

## 🛠️ Tecnologías

* **Node.js** v18+
* **Express.js** (Servidor Webhook)
* **Axios** (Peticiones HTTP a Kapso)
* **@google/generative-ai** (SDK oficial de Gemini)
* **dotenv** (Variables de entorno)
* **pm2** (Gestor de procesos para producción)

## 🚀 Instalación y Uso Local

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/Ing-pinxxon/BotSaboratto.git
   cd BotSaboratto
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar Variables de Entorno**
   Crea un archivo `.env` en la raíz del proyecto y añade:
   ```env
   PORT=3000
   KAPSO_API_KEY=tu_api_key_de_kapso
   KAPSO_PROJECT_ID=tu_project_id_de_kapso
   GEMINI_API_KEY=tu_api_key_de_google_aistudio
   KITCHEN_NUMBER=573000000000 # Número de WhatsApp de la cocina
   ```

4. **Iniciar el Servidor en Desarrollo**
   ```bash
   npm run dev
   ```

5. **Exponer el Webhook (Localtunnel)**
   Para que Kapso pueda enviarte mensajes mientras desarrollas localmente, abre otra terminal y ejecuta:
   ```bash
   npm run tunnel
   ```
   Copia la URL pública generada (ej. `https://agente-saboratto-gemi.loca.lt/webhook`) y pégala en la configuración de Webhooks de tu proyecto en Kapso.

## 📦 Comandos Disponibles

En el archivo `package.json` están configurados los siguientes scripts:

* `npm start`: Inicia el servidor de forma normal con Node.
* `npm run dev`: Inicia el servidor en modo *watch*. Se reinicia automáticamente si detecta cambios en el código.
* `npm run tunnel`: Abre un túnel local en el puerto 3000 usando `localtunnel`.
* `npm run pm2:start`: Inicia el bot en segundo plano usando PM2 (ideal para servidores VPS).
* `npm run pm2:logs`: Muestra los logs en vivo del bot corriendo en PM2.
* `npm run pm2:stop`: Detiene el bot de PM2.

## 🧠 Configuración del Agente (Prompts)

Toda la lógica de negocio, menú, precios, tono de voz y reglas críticas se encuentra en el archivo `index.js`, dentro del objeto `AGENT_SKILLS`.
Si necesitas modificar precios o agregar un producto nuevo, búscalo en las secciones `OPEN` y `CLOSED` de los prompts en ese archivo.

---
**Desarrollado para:** Saboratto 🍔
