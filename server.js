const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_FACTURA = 'Eres experto en facturas de restaurante. Analiza la imagen y extrae todos los productos. Responde SOLO con JSON valido sin texto extra. Estructura: {"proveedor":"string","fecha":"string","productos":[{"nombre":"string","cantidad":1,"unidad":"kg","precio_unitario":0,"precio_total":0,"categoria":"Carnes"}],"total_factura":0}';

const PROMPT_MENU = 'Eres experto en menus de restaurante. Analiza la imagen y extrae todos los platillos/bebidas con sus precios. Responde SOLO con JSON valido sin texto extra. Estructura: {"area":"string","items":[{"nombre":"string","descripcion":"string","precio":0,"categoria":"string"}]}';

async function callAnthropic(system, imageB64, mediaType, text) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageB64 } },
          { type: "text", text }
        ]
      }]
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.content.map(b => b.text || "").join("").trim();
}

// Health check
app.get("/", (req, res) => res.status(200).json({ ok: true, service: "galea-backend" }));
app.get("/health", (req, res) => res.status(200).send("ok"));

// Chat con asistente AI
app.post("/chat", async (req, res) => {
  const { system, messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Se requiere messages[]" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: system || "Eres el asistente del restaurante Galea. Responde en español, conciso.",
        messages: messages.filter(m => m.role && m.content),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "Error Anthropic", detail: data });
    const content = data.content.map(b => b.text || "").join("").trim();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Escanear factura (imagen base64)
app.post("/scan-factura", async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: "Se requiere image_base64" });
  try {
    const raw = await callAnthropic(PROMPT_FACTURA, image_base64, media_type, "Extrae todos los productos y precios de esta factura.");
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(422).json({ error: "No se pudo parsear la respuesta", raw }); }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Escanear menú (imagen base64)
app.post("/scan-menu", async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: "Se requiere image_base64" });
  try {
    const raw = await callAnthropic(PROMPT_MENU, image_base64, media_type, "Lee este menu completo y extrae todos los items con sus precios.");
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(422).json({ error: "No se pudo parsear la respuesta", raw }); }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Galea backend en puerto ${PORT}`));
