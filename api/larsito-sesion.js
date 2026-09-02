// Autoriza y abre una sesión del producto completo de Larsito.
// POST -> {ok:true, signed_url, turnos_restantes}
//
// El flag permanece cerrado por defecto. Con el producto abierto, la cookie y la
// compra se verifican antes de reservar en una sola transaccion la cuota de la
// compra, la global y el limite de intentos fallidos o pendientes. La firma interna
// lleva reserva_id y jti: este mismo puente la canjea una sola vez antes de devolver
// el signed URL de ElevenLabs. La API key nunca sale de este servidor.

import { readSessionCookie, compraActiva, sbRpc, jwtSign } from "../server/shared/norsk-lib.mjs";
import {
  consumirFirmaLarsito,
  registrarFalloFirmaLarsito,
} from "../server/shared/larsito-reservas.mjs";

const TOPE_DIARIO = 60;
const TOPE_GLOBAL_DEFECTO = 2000;
const TOPE_FALLOS_DEFECTO = 6;
const FIRMA_MINUTOS = 15;
const PROVEEDOR_TIMEOUT_MS = 10000;

// Este endpoint es el consumidor real: verifica y canjea la firma antes de
// entregar al navegador el permiso temporal que emite ElevenLabs.
const CONSUMIDOR_INTEGRADO = true;

function enteroPositivo(raw, defecto, maximo) {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) return defecto;
  return n;
}

function primeraFila(valor) {
  if (Array.isArray(valor)) return valor[0] || null;
  return valor && typeof valor === "object" ? valor : null;
}

export function crearFirmaLarsito(compraId, reserva, secreto, ahora) {
  const emitida = Number.isSafeInteger(ahora)
    ? ahora
    : Math.floor(Date.now() / 1000);
  const exp = emitida + FIRMA_MINUTOS * 60;
  return {
    exp,
    firma: jwtSign({
      sub: compraId,
      iat: emitida,
      exp,
      aud: "larsito-consumer",
      uso: "larsito",
      reserva_id: reserva.reserva_id,
      jti: reserva.jti,
    }, secreto),
  };
}

async function obtenerSignedUrl(agenteId, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVEEDOR_TIMEOUT_MS);
  try {
    // La firma ligada a una conversacion no se puede reutilizar para abrir
    // conversaciones paralelas durante sus quince minutos de validez.
    const query = new URLSearchParams({
      agent_id: agenteId,
      include_conversation_id: "true",
    });
    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?${query}`,
      {
        method: "GET",
        headers: { "xi-api-key": apiKey, Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!r.ok) {
      if (r.body && r.body.cancel) await r.body.cancel().catch(() => {});
      throw new Error(`proveedor ${r.status}`);
    }
    const body = await r.json();
    if (!body || typeof body.signed_url !== "string" || !/^wss:\/\//i.test(body.signed_url)) {
      throw new Error("proveedor sin signed_url");
    }
    return body.signed_url;
  } finally {
    clearTimeout(timeout);
  }
}

async function registrarFalloSeguro(firma, secreto) {
  try {
    return (await registrarFalloFirmaLarsito(firma, secreto)).ok === true;
  } catch (err) {
    console.error("larsito-sesion fallo no disponible");
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!CONSUMIDOR_INTEGRADO
      || process.env.LARSITO_ON !== "true"
      || process.env.LARSITO_CONSUMER_READY !== "true"
      || process.env.LARSITO_AGENT_PRIVACY_READY !== "true") {
    res.status(200).json({
      ok: false,
      error: "cerrado",
      mensaje: "Larsito todavía no está abierto.",
    });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }

  const secreto = process.env.NORSK_JWT_SECRET;
  const agenteId = process.env.LARSITO_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!secreto || !agenteId || !apiKey) {
    console.error("larsito-sesion configuracion incompleta");
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
    console.error("larsito-sesion compra no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }
  if (!compra) {
    res.status(401).json({ ok: false, error: "caducado" });
    return;
  }

  const topeGlobal = enteroPositivo(
    process.env.LARSITO_TOPE_GLOBAL,
    TOPE_GLOBAL_DEFECTO,
    1000000,
  );
  const topeFallos = enteroPositivo(
    process.env.LARSITO_TOPE_FALLOS,
    TOPE_FALLOS_DEFECTO,
    100,
  );

  let reserva;
  try {
    reserva = primeraFila(await sbRpc("norsk_reservar_larsito", {
      p_compra: compra.id,
      p_tipo: "larsito",
      p_tope_compra: TOPE_DIARIO,
      p_tope_global: topeGlobal,
      p_tope_fallos: topeFallos,
      p_vida_segundos: FIRMA_MINUTOS * 60,
      p_coste: 1,
    }));
  } catch (err) {
    console.error("larsito-sesion reserva no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  if (!reserva || reserva.ok !== true || !reserva.reserva_id || !reserva.jti) {
    const motivo = reserva && reserva.error;
    if (motivo === "limite") {
      res.status(429).json({
        ok: false,
        error: "limite",
        mensaje: `Has hecho ${TOPE_DIARIO} conversaciones hoy. Puedes volver mañana.`,
      });
      return;
    }
    if (motivo === "saturado") {
      res.status(429).json({
        ok: false,
        error: "saturado",
        mensaje: "Larsito ha alcanzado el límite global de hoy.",
      });
      return;
    }
    if (motivo === "fallos") {
      res.status(429).json({
        ok: false,
        error: "fallos",
        mensaje: "Hay demasiados intentos fallidos o pendientes hoy. Inténtalo mañana.",
      });
      return;
    }
    if (motivo === "acceso") {
      res.status(401).json({ ok: false, error: "caducado" });
      return;
    }
    console.error("larsito-sesion reserva invalida");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const { firma } = crearFirmaLarsito(compra.id, reserva, secreto);

  let signedUrl;
  try {
    signedUrl = await obtenerSignedUrl(agenteId, apiKey);
  } catch (err) {
    await registrarFalloSeguro(firma, secreto);
    console.error("larsito-sesion proveedor no disponible");
    res.status(502).json({ ok: false, error: "proveedor" });
    return;
  }

  // La firma propia se consume justo antes de abrir la conexión del navegador.
  // Si falla, nunca se entrega el signed URL aunque ElevenLabs ya haya respondido.
  let consumida;
  try { consumida = await consumirFirmaLarsito(firma, secreto); }
  catch (err) { consumida = { ok: false, error: "no_disponible" }; }
  if (!consumida || consumida.ok !== true) {
    await registrarFalloSeguro(firma, secreto);
    console.error("larsito-sesion consumo no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const usados = Number(reserva.usos_compra);
  res.status(200).json({
    ok: true,
    signed_url: signedUrl,
    turnos_restantes: Number.isFinite(usados) ? Math.max(0, TOPE_DIARIO - usados) : 0,
    expira_en: FIRMA_MINUTOS * 60,
  });
}
