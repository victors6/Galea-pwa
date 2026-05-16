const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_FACTURA =
  "Eres experto en facturas de restaurante. Analiza la imagen y extrae todos los productos. " +
  "Responde SOLO con JSON valido sin texto extra. " +
  'Estructura: {"proveedor":"string","fecha":"string o null","productos":[{"nombre":"string","cantidad":1,"unidad":"kg","precio_unitario":0,"precio_total":0,"categoria":"Carnes"}],"total_factura":0}';

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "restaurante-backend" });
});

// Analizar factura con imagen base64 (JSON body)
app.post("/scan-factura", async (req, res) => {
  const { image_base64, media_type } = req.body;

  if (!image_base64) {
    return res.status(400).json({ error: "Se requiere image_base64" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: PROMPT_FACTURA,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: media_type || "image/jpeg",
                  data: image_base64,
                },
              },
              {
                type: "text",
                text: "Extrae todos los productos y precios de esta factura.",
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: "Error Anthropic", detail: data });
    }

    const raw = data.content
      .map((b) => b.text || "")
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res
        .status(422)
        .json({ error: "No se pudo parsear respuesta de IA", raw });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Error interno", detail: err.message });
  }
});

// Analizar factura con archivo multipart (foto desde móvil)
app.post("/scan-factura-file", upload.single("imagen"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Se requiere archivo imagen" });
  }

  const b64 = req.file.buffer.toString("base64");
  const mime = req.file.mimetype || "image/jpeg";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: PROMPT_FACTURA,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mime, data: b64 },
              },
              {
                type: "text",
                text: "Extrae todos los productos y precios de esta factura.",
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: "Error Anthropic", detail: data });
    }

    const raw = data.content
      .map((b) => b.text || "")
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res
        .status(422)
        .json({ error: "No se pudo parsear respuesta de IA", raw });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Error interno", detail: err.message });
  }
});

// Chat con el asistente AI
app.post("/chat", async (req, res) => {
  const { system, messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Se requiere messages[]" });
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: system || "Eres el asistente del restaurante Galea. Responde en español, de forma concisa.",
        messages: messages.filter(m => m.role && m.content),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: "Error Anthropic", detail: data });
    }
    const content = data.content.map(b => b.text || "").join("").trim();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: "Error interno", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Restaurante backend corriendo en puerto", PORT);
});
