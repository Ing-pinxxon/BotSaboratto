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
* **👨‍🍳 Comanda de Cocina + Boucher:** Cuando el cliente **confirma** su pedido (el bot muestra "¿Me confirmas? ✅" y el cliente dice "Sí/listo"), en ese mismo momento el bot: (1) arma una **comanda con el nombre del cliente** en formato de cocina y la envía al número de WhatsApp de la cocina (número **1:1**, ya que la API de WhatsApp no envía a grupos), y (2) guarda el pedido como **boucher/traza** en un CSV local (`data/pedidos.csv`) y, opcionalmente, en una **hoja de cálculo de Google Sheets** en la nube para análisis y decisiones. El diseño queda listo para conectar una impresora térmica más adelante.

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
   Crea un archivo `.env` en la raíz del proyecto (usa `.env.example` como base) y añade:
   ```env
   PORT=3000
   KAPSO_API_KEY=tu_api_key_de_kapso
   KAPSO_PROJECT_ID=tu_project_id_de_kapso
   GEMINI_API_KEY=tu_api_key_de_google_aistudio
   KITCHEN_NUMBER=573000000000 # Número 1:1 de WhatsApp de la cocina (NO un grupo)
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

## 🧾 Boucher / Traza de Pedidos

Cada pedido **confirmado** se guarda automáticamente para dejar traza y alimentar decisiones:

* **CSV local (siempre):** se agrega una fila a `data/pedidos.csv` con las columnas
  `Fecha, Hora, N°, Cliente, Numero, Items, Subtotal, Icopor, Domicilio, Total, DiaSemana`.
  Esta carpeta contiene datos de clientes (PII) y está en `.gitignore` — no se versiona.
* **Google Sheets (nube, opcional):** si configuras las variables de Google, la misma fila se agrega a una hoja de cálculo en la nube que puedes abrir desde el celular, compartir y analizar.

### Configurar Google Sheets (opcional)

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto y habilita **Google Sheets API**.
2. Crea un **Service Account** y genera una clave JSON.
3. Crea una hoja de cálculo en Google Sheets y **compártela como Editor** con el email del service account (algo como `tu-bot@tu-proyecto.iam.gserviceaccount.com`).
4. Copia el **ID de la hoja** desde su URL: `.../spreadsheets/d/`**`<ESTE_ID>`**`/edit`.
5. Agrega a tu `.env`:
   ```env
   GOOGLE_SHEET_ID=el_id_de_tu_hoja
   GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-bot@tu-proyecto.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```
   El encabezado de la hoja se crea solo la primera vez.

> **Impresora (a futuro):** el texto de la comanda se genera en `config/hooks.js`
> (`buildKitchenComanda`), listo para enviarse a una impresora térmica ESC/POS.
> Si el bot corre en el local, se puede imprimir directo (USB/red); si corre en un
> VPS, se puede usar un servicio como PrintNode o un mini-agente en el local.

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
