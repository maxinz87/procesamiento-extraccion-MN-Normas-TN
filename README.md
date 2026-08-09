## Sobre la App
App para extraer y calcular materiales normalizados en base a los materiales detallados de los archivos PDFs de los TNs.

Dichos archivos PDFs se obtienen de la web de información técnica de EPE: https://www.epe.santafe.gov.ar/index.php?infotec

## Para ejecutarlo localmente

**Pre requisitos:**  Node.js

1. Instalar las dependencias:
   `npm install`
2. Ejecutar la app:
   `npm run dev`

## Consideraciones de uso de la App

Utilizar una GEMINI_API_KEY provista por una cuenta google enlazada a google AI Studio para poder hacer uso de la IA de Gemini para procesar los archivos PDFs. Dicha key se obtiene accediendo a https://aistudio.google.com. 

Tener en cuenta que el número de uso de la key es límitado en su versión gratuita por lo que es recomendado tener varias GEMINI_API_KEY de diferentes cuentas de google para poder hacer uso exhaustivo de la herramienta.

