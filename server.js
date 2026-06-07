const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

// Health
app.get("/", (req, res) => res.json({ ok: true }));
app.get("/health", (req, res) => res.send("ok"));

// Proxy genérico para todas las llamadas AI del frontend
app.post("/proxy", async (req, res) => {
  try {
    const body = { ...req.body };
    // Forzar modelo correcto por seguridad
    if (!body.model) body.model = MODEL;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan factura (base64)
app.post("/scan-factura", async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: "Falta image_base64" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1000,
        system: 'Eres experto en facturas de restaurante. Analiza la imagen y extrae todos los productos. Responde SOLO con JSON valido sin texto extra. Estructura: {"proveedor":"string","fecha":"string","productos":[{"nombre":"string","cantidad":1,"unidad":"kg","precio_unitario":0,"precio_total":0,"categoria":"Carnes"}],"total_factura":0}',
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image_base64 } },
          { type: "text", text: "Extrae todos los productos y precios." }
        ]}]
      }),
    });
    const data = await r.json();
    const raw = data.content.map(b => b.text || "").join("").trim();
    res.json(JSON.parse(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chat asistente
app.post("/chat", async (req, res) => {
  const { system, messages } = req.body;
  if (!messages) return res.status(400).json({ error: "Falta messages" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: system || "", messages }),
    });
    const data = await r.json();
    res.json({ content: data.content.map(b => b.text || "").join("").trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Galea backend en puerto", PORT));
