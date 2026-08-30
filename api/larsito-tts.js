// Convierte una frase noruega en audio mp3 con la API de voz de OpenAI, para los
// botones de escucha de Larsito (/norsk/larsito/).
// GET ?ping=1                          -> {ok:true} si el servicio está encendido
// GET ?texto=<frase>&velocidad=1|0.8   -> audio/mpeg
//
// Contrato:
//   1. Flag primero: mientras LARSITO_TTS no valga exactamente "on" (o falte
//      OPENAI_API_KEY), el endpoint está cerrado y responde 200 con
//      {ok:false, error:"cerrado"}. Esa comprobación va antes que ninguna otra,
//      para poder desplegar sin claves y sin gasto. El ping nunca llama a OpenAI.
//   2. Muro con lista blanca: la demo se usa sin login, así que las frases de la
//      demo (hashes SHA-256 en api/_larsito_frases.js, generado por
//      scripts/larsito_frases_hash.mjs) se sirven sin cookie. Cualquier otro
//      texto exige cookie de sesión firmada y compra activa comprobada en
//      servidor, el mismo muro que el resto de NEXO PASS. Así nadie convierte
//      este endpoint en un lector de textos arbitrarios a nuestra costa.
//   3. Caché: cada mp3 sale con Cache-Control public, s-maxage=31536000,
//      immutable. La CDN de Vercel guarda cada frase un año, de modo que una
//      frase de la demo solo se genera una vez en OpenAI por región; el resto de
//      reproducciones no cuestan nada.

import crypto from "node:crypto";
import { readSessionCookie, compraActiva } from "./_norsk_lib.js";
import { FRASES_DEMO } from "./_larsito_frases.js";

// Tope de longitud del texto. Las frases de la demo caben de sobra; esto corta
// cualquier intento de colar un texto largo aunque venga de un comprador.
const MAX_CARACTERES = 300;

// MISMA normalización que scripts/larsito_frases_hash.mjs. Si cambia aquí,
// hay que regenerar la lista blanca.
function normalizar(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  // Interruptor general, antes que ninguna otra comprobación. Apagado tiene que
  // ser inofensivo: ni 500, ni filtrar si hay compra o no.
  if (process.env.LARSITO_TTS !== "on" || !process.env.OPENAI_API_KEY) {
    res.status(200).json({ ok: false, error: "cerrado" });
    return;
  }

  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "metodo" }); return; }

  const q = req.query || {};

  // El ping solo dice si el servicio está encendido. Nunca toca OpenAI.
  if (q.ping) { res.status(200).json({ ok: true }); return; }

  const texto = normalizar(q.texto);
  if (!texto || texto.length > MAX_CARACTERES) {
    res.status(400).json({ ok: false, error: "texto" });
    return;
  }

  // Solo dos velocidades: normal y lenta. Cualquier otro valor se normaliza a 1.
  const velocidad = q.velocidad === "0.8" ? 0.8 : 1;

  // Control de coste sin login: las frases de la demo pasan por hash; el resto
  // exige el muro de pago completo.
  const hash = crypto.createHash("sha256").update(texto, "utf8").digest("hex");
  if (!FRASES_DEMO.has(hash)) {
    const sesion = readSessionCookie(req);
    if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }
    let compra;
    try { compra = await compraActiva(sesion.sub); } catch (e) {
      console.error("larsito-tts compra", e);
      res.status(500).json({ ok: false, error: "interno" });
      return;
    }
    if (!compra) { res.status(401).json({ ok: false, error: "acceso" }); return; }
  }

  let r;
  try {
    r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: texto,
        response_format: "mp3",
        speed: velocidad,
        instructions: "Snakk naturlig og tydelig norsk bokmål, i et rolig tempo, som en vennlig samtalepartner.",
      }),
    });
  } catch (e) {
    console.error("larsito-tts red", e);
    res.status(502).json({ ok: false, error: "voz" });
    return;
  }

  if (!r.ok) {
    console.error("larsito-tts openai", r.status, await r.text().catch(() => ""));
    res.status(502).json({ ok: false, error: "voz" });
    return;
  }

  const audio = Buffer.from(await r.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, s-maxage=31536000, immutable");
  res.status(200).send(audio);
}
