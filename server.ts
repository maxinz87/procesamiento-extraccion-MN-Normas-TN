import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route: Check configuration and server key status
  app.get('/api/config', (req, res) => {
    res.json({
      hasServerKey: !!process.env.GEMINI_API_KEY,
      defaultModel: 'gemini-3.6-flash'
    });
  });

  // API Route: Process PDF image with Gemini Flash
  app.post('/api/process-page', async (req, res) => {
    try {
      const { imageBase64, customApiKey, model } = req.body;
      const apiKey = customApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({
          error: 'No se ha configurado ninguna API Key de Gemini. Por favor, ingresa tu API Key en la interfaz o configura GEMINI_API_KEY.'
        });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      const promptText = `Analiza el siguiente documento/plano en la imagen:

1. EXTRAER CÓDIGO TN DEL DOCUMENTO:
Busca en el rectángulo o cajetín ubicado en el extremo inferior derecho de la hoja. Dentro de ese rectángulo inferior derecho, observa la primera fila (fila superior) y extrae el texto o código que siempre comenzará por "TN" (por ejemplo: "TN123", "TN-45", "TN 201a", etc.). Si no existe o no es legible, asigna una cadena vacía "".

2. EXTRAER RENGLONES DE LA TABLA:
Extrae todos los renglones de la tabla detectando las siguientes columnas exactas:
- CÓDIGO
- MATRIC.
- DESCRIPCIÓN
- UNIDAD
- CANT.

Reglas para la tabla:
- La columna "Código" puede comenzar de dos formas: 
  * Si comienza por "MN" sigue un espacio en blanco y luego un número de 1, 2, 3 o 4 cifras donde, opcionalmente, puede seguir de una letra. Por ejemplo: "MN 202c".
  * Si comienza por "TN" o "ETN" sigue de un número de 1, 2, 3 o 4 cifras seguido, opcionalmente, de una letra. Por ejemplo: "TN142g"
- El campo "MATRÍC." consta sólo de números de 6 dígitos.
- El campo "UNIDAD" tendrá solamente valores "Pza", "Mts" o "Conj".
- Si "CÓDIGO" está vacío o no tiene valor asignar el valor 0 a dicho campo.

Devuelve un objeto JSON con esta estructura exacta:
{
  "tn": "Código TN del documento extraído del rectángulo inferior derecho (ej: 'TN123')",
  "items": [
    { "codigo": "...", "matric": "...", "descripcion": "...", "unidad": "...", "cant": 0 }
  ]
}
Asegúrate de convertir el campo 'CANT.' a un número (float o int). Si un campo no existe o no es legible, coloca una cadena vacía o 0 para la cantidad.`;

      const candidateModels = Array.from(new Set(
        model ? [model, 'gemini-3.6-flash', 'gemini-flash-latest'] : ['gemini-3.6-flash', 'gemini-flash-latest']
      ));
      let response = null;
      let lastError = null;
      let model429Count = 0;

      for (let i = 0; i < candidateModels.length; i++) {
        const targetModel = candidateModels[i];
        let modelSuccess = false;

        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            response = await ai.models.generateContent({
              model: targetModel,
              contents: [
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64
                  }
                },
                { text: promptText }
              ],
              config: {
                responseMimeType: 'application/json',
                temperature: 0.1
              }
            });
            if (response) {
              modelSuccess = true;
              break;
            }
          } catch (err: any) {
            console.warn(`Attempt ${attempt} error with model ${targetModel}:`, err.message || err);
            lastError = err;

            const errMsg = String(err.message || err);
            const isRateLimit = err.status === 429 || errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED');

            if (isRateLimit) {
              model429Count++;
              if (attempt < 4) {
                let delayMs = Math.pow(2, attempt) * 2000;
                const match = errMsg.match(/retry in ([0-9.]+)s/i);
                if (match && match[1]) {
                  const parsedSec = parseFloat(match[1]);
                  if (!isNaN(parsedSec) && parsedSec > 0) {
                    delayMs = Math.min(Math.ceil(parsedSec * 1000) + 1000, 15000);
                  }
                }
                console.log(`Límite de cuota alcanzado (429) en ${targetModel}. Esperando ${delayMs / 1000}s...`);
                await new Promise(r => setTimeout(r, delayMs));
              }
            } else {
              await new Promise(r => setTimeout(r, 1000 * attempt));
            }
          }
        }
        if (modelSuccess && response) break;
      }

      if (!response) {
        const errMsg = String(lastError?.message || lastError || '');
        const isQuotaError = errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED') || model429Count > 0;
        
        if (isQuotaError) {
          return res.status(429).json({
            code: 429,
            errorType: 'ALL_MODELS_EXCEEDED',
            error: 'Todos los modelos de GEMINI han excedido el límite de uso y no será posible procesar los archivos PDFs.'
          });
        }
        throw lastError || new Error('No se pudo procesar la imagen con los modelos de Gemini disponibles.');
      }

      const text = response.text || '{}';
      let parsedData: any = {};
      try {
        parsedData = JSON.parse(text);
      } catch (e) {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedData = JSON.parse(cleanedText);
      }

      let pageTn = '';
      let items: any[] = [];

      if (Array.isArray(parsedData)) {
        items = parsedData;
        const itemWithTn = parsedData.find((i: any) => i && i.tn);
        if (itemWithTn) pageTn = String(itemWithTn.tn || '').trim();
      } else if (parsedData && typeof parsedData === 'object') {
        if (parsedData.tn) pageTn = String(parsedData.tn).trim();
        if (Array.isArray(parsedData.items)) {
          items = parsedData.items;
        } else if (Array.isArray(parsedData.data)) {
          items = parsedData.data;
        }
      }

      res.json({ tn: pageTn, items: items });
    } catch (error: any) {
      console.error('Error procesando página con Gemini:', error);
      const errMsg = String(error.message || error);
      const is429 = error.status === 429 || errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED');

      if (is429) {
        return res.status(429).json({
          code: 429,
          errorType: 'ALL_MODELS_EXCEEDED',
          error: 'Todos los modelos de GEMINI han excedido el límite de uso y no será posible procesar los archivos PDFs.'
        });
      }

      res.status(500).json({
        error: error.message || 'Error al comunicarse con la API de Gemini.'
      });
    }
  });

  // Vite middleware for development or static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
