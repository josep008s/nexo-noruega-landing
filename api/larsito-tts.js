// TTS del producto completo de Larsito. La demo publica no llama a este endpoint.
// POST {texto, velocidad: 1|0.8} -> audio/mpeg
//
// Contrato: flag cerrado por defecto, cookie firmada y compra activa, cuerpo y
// texto acotados, reserva atomica de cuotas, respuesta privada, timeout propio y
// lectura incremental con un maximo de 4 MiB. Nunca recibe audio del alumno.

import {
  readJsonBodyLimited,
  readSessionCookie,
  compraActiva,
  sbRpc,
  jwtSign,
} from "./_norsk_lib.js";

const MAX_BODY_BYTES = 2 * 1024;
const MAX_CARACTERES = 300;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const TOPE_COMPRA_DEFECTO = 300;
const TOPE_GLOBAL_DEFECTO = 10000;
const TOPE_FALLOS_DEFECTO = 6;
const RESERVA_VIDA_SEGUNDOS = 120;
const COMPENSACION_HORAS = 48;

function normalizar(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ");
}

function enteroPositivo(raw, defecto, maximo) {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) return defecto;
  return n;
}

function primeraFila(valor) {
  if (Array.isArray(valor)) return valor[0] || null;
  return valor && typeof valor === "object" ? valor : null;
}

async function leerAudioAcotado(response) {
  const declarado = Number(response.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_AUDIO_BYTES) {
    if (response.body && response.body.cancel) await response.body.cancel().catch(() => {});
    throw new Error("audio demasiado grande");
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const b = Buffer.from(await response.arrayBuffer());
    if (b.length > MAX_AUDIO_BYTES) throw new Error("audio demasiado grande");
    return b;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("audio demasiado grande");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function consumir(reserva, compraId) {
  try {
    return await sbRpc("norsk_consumir_reserva_larsito", {
      p_reserva: reserva.reserva_id,
      p_compra: compraId,
      p_tipo: "larsito_tts",
      p_jti: reserva.jti,
    }) === true;
  } catch (err) {
    console.error("larsito-tts consumo no disponible");
    return false;
  }
}

async function registrarFallo(reserva, compraId) {
  try {
    return await sbRpc("norsk_registrar_fallo_larsito", {
      p_reserva: reserva.reserva_id,
      p_compra: compraId,
      p_tipo: "larsito_tts",
      p_jti: reserva.jti,
    }) === true;
  } catch (err) {
    console.error("larsito-tts registro de fallo no disponible");
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // El interruptor se comprueba antes de autenticacion, cuerpo o proveedor.
  if (process.env.LARSITO_TTS !== "on"
      || process.env.LARSITO_PRIVACY_READY !== "true"
      || !process.env.OPENAI_API_KEY) {
    res.status(200).json({ ok: false, error: "cerrado" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }

  const secreto = process.env.NORSK_JWT_SECRET;
  if (!secreto) {
    console.error("larsito-tts configuracion incompleta");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const sesion = readSessionCookie(req);
  if (!sesion) {
    res.status(401).json({ ok: false, error: "acceso" });
    return;
  }

  let compra;
  try { compra = await compraActiva(sesion.sub); }
  catch (err) {
    console.error("larsito-tts compra no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }
  if (!compra) {
    res.status(401).json({ ok: false, error: "caducado" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    res.status(415).json({ ok: false, error: "tipo" });
    return;
  }

  let body;
  try { body = await readJsonBodyLimited(req, MAX_BODY_BYTES); }
  catch (err) {
    res.status(err.status || 400).json({ ok: false, error: err.code || "json" });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "json" });
    return;
  }

  const texto = normalizar(body.texto);
  if (!texto || texto.length > MAX_CARACTERES) {
    res.status(400).json({ ok: false, error: "texto" });
    return;
  }

  let velocidad;
  if (body.velocidad === 0.8 || body.velocidad === "0.8") velocidad = 0.8;
  else if (body.velocidad === 1 || body.velocidad === "1") velocidad = 1;
  else {
    res.status(400).json({ ok: false, error: "velocidad" });
    return;
  }

  const topeCompra = enteroPositivo(
    process.env.LARSITO_TTS_TOPE_COMPRA,
    TOPE_COMPRA_DEFECTO,
    1000000,
  );
  const topeGlobal = enteroPositivo(
    process.env.LARSITO_TTS_TOPE_GLOBAL,
    TOPE_GLOBAL_DEFECTO,
    10000000,
  );
  const topeFallos = enteroPositivo(
    process.env.LARSITO_TTS_TOPE_FALLOS,
    TOPE_FALLOS_DEFECTO,
    100,
  );

  let reserva;
  try {
    reserva = primeraFila(await sbRpc("norsk_reservar_larsito", {
      p_compra: compra.id,
      p_tipo: "larsito_tts",
      p_tope_compra: topeCompra,
      p_tope_global: topeGlobal,
      p_tope_fallos: topeFallos,
      p_vida_segundos: RESERVA_VIDA_SEGUNDOS,
      p_coste: 1,
    }));
  } catch (err) {
    console.error("larsito-tts reserva no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  if (!reserva || reserva.ok !== true || !reserva.reserva_id || !reserva.jti) {
    const motivo = reserva && reserva.error;
    if (motivo === "limite" || motivo === "saturado" || motivo === "fallos") {
      res.status(429).json({ ok: false, error: motivo });
      return;
    }
    if (motivo === "acceso") {
      res.status(401).json({ ok: false, error: "caducado" });
      return;
    }
    console.error("larsito-tts reserva invalida");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const expCompensacion = Math.floor(Date.now() / 1000) + COMPENSACION_HORAS * 60 * 60;
  const tokenCompensacion = jwtSign({
    sub: compra.id,
    reserva: reserva.reserva_id,
    jti: reserva.jti,
    tipo: "larsito_tts",
    exp: expCompensacion,
    uso: "larsito_compensar",
  }, secreto);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  let audio;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: process.env.LARSITO_TTS_VOZ || "ash",
        input: texto,
        response_format: "mp3",
        speed: velocidad,
        instructions: "Snakk naturlig og tydelig norsk bokmål, i et rolig tempo, som en vennlig samtalepartner.",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.body && response.body.cancel) await response.body.cancel().catch(() => {});
      throw new Error(`proveedor ${response.status}`);
    }
    const tipo = response.headers.get("content-type") || "";
    if (!tipo.toLowerCase().startsWith("audio/")) {
      if (response.body && response.body.cancel) await response.body.cancel().catch(() => {});
      throw new Error("respuesta sin audio");
    }
    audio = await leerAudioAcotado(response);
  } catch (err) {
    const compensada = await registrarFallo(reserva, compra.id);
    const fallo = {
      ok: false,
      error: "voz",
      compensada,
    };
    // Solo se entrega una via de reintento cuando el servidor sabe que no hubo
    // audio y no pudo completar la compensacion. Nunca sale en una respuesta OK.
    if (!compensada) fallo.compensacion = tokenCompensacion;
    res.status(502).json(fallo);
    return;
  } finally {
    clearTimeout(timeout);
  }

  // La reserva se consume antes de entregar el audio. Si el cierre atomico no
  // se confirma, no sale ningun resultado y el intento queda registrado como
  // fallo: se devuelve la cuota de compra, pero se conservan coste global y
  // riesgo para impedir bucles de proveedor fallido.
  const consumida = await consumir(reserva, compra.id);
  if (!consumida) {
    const compensada = await registrarFallo(reserva, compra.id);
    const fallo = { ok: false, error: "voz", compensada };
    if (!compensada) fallo.compensacion = tokenCompensacion;
    res.status(502).json(fallo);
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", String(audio.length));
  res.status(200).send(audio);
}
