const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();

// multer: imagen sola (facturas)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// multer: multiples archivos (corte — imagenes + PDF)
const uploadMulti = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

async function claude(system, messages, maxTokens = 1000) {
  console.log('KEY exists:', !!KEY, 'KEY prefix:', KEY ? KEY.substring(0, 15) : 'NONE');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages
    })
  });
  const d = await r.json();
  console.log('ANTHROPIC RESPONSE:', JSON.stringify(d).substring(0, 300));
  return d.content?.[0]?.text || 'Sin respuesta.';
}

app.get('/', (req, res) => {
  res.json({ status: "Iddi's Bakery AI - Activo" });
});

app.post('/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });
  try {
    const reply = await claude(
      `Eres el asistente operativo de Iddis Bakery, cafeteria y panaderia en Mexico. Responde en espanol, directo y practico. Usa MXN. Sin asteriscos ni markdown.\n\nDATA:\n${context || 'Sin datos.'}`,
      [{ role: 'user', content: message }]
    );
    res.json({ reply });
  } catch (e) {
    console.log('ERROR:', e.message);
    res.status(500).json({ error: 'Error.' });
  }
});

app.post('/factura', async (req, res) => {
  const { texto, context } = req.body;
  if (!texto) return res.status(400).json({ error: 'Texto requerido' });
  try {
    const reply = await claude(
      'Eres el asistente financiero de Iddis Bakery en Mexico. Analiza facturas. Espanol, sin asteriscos.',
      [{ role: 'user', content: `Analiza esta factura:\n${texto}\n\nInventario:\n${context}\n\nDime que subio y que actualizar.` }],
      1500
    );
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: 'Error.' });
  }
});

// ── /factura-imagen — una sola imagen (facturas de proveedor) ─────
app.post('/factura-imagen', upload.single('imagen'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
  const context = req.body.context || '';
  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'Eres el asistente financiero de Iddis Bakery. Lee facturas en imagen y compara con inventario.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: context }
          ]
        }]
      })
    });
    const d = await r.json();
    console.log('IMAGEN RESPONSE:', JSON.stringify(d).substring(0, 300));
    res.json({ reply: d.content?.[0]?.text || 'No pude leer la factura.' });
  } catch (e) {
    res.status(500).json({ error: 'Error al procesar imagen.' });
  }
});

// ── /corte — múltiples archivos (imágenes + PDF) para corte de ventas ─────
app.post('/corte', uploadMulti.array('archivos', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Se requiere al menos un archivo.' });
  const context = req.body.context || '';
  try {
    // Construir content con todos los archivos
    const content = [];
    for (const file of req.files) {
      const base64 = file.buffer.toString('base64');
      const mime = file.mimetype || 'image/jpeg';
      if (mime === 'application/pdf') {
        // PDF como documento
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      } else {
        // Imagen
        const validMime = ['image/jpeg','image/png','image/gif','image/webp'].includes(mime) ? mime : 'image/jpeg';
        content.push({ type: 'image', source: { type: 'base64', media_type: validMime, data: base64 } });
      }
    }
    content.push({ type: 'text', text: context });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: 'Eres el analista financiero de Iddis Bakery Mexico. Lees cortes de caja (PDF, foto de ticket, resumen impreso) y produces analisis financieros completos. Si hay multiples archivos, consolida todo. Responde en espanol sin asteriscos.',
        messages: [{ role: 'user', content }]
      })
    });
    const d = await r.json();
    console.log('CORTE RESPONSE:', JSON.stringify(d).substring(0, 300));
    res.json({ reply: d.content?.[0]?.text || 'No pude leer el corte.' });
  } catch (e) {
    console.log('CORTE ERROR:', e.message);
    res.status(500).json({ error: 'Error al procesar el corte.' });
  }
});

app.listen(PORT, () => console.log(`Puerto ${PORT} - KEY loaded: ${!!KEY}`));
