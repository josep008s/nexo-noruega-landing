// Autoriza una sesión de conversación de voz con Larsito (NEXO NORSK).
// POST  -> { ok:true, agente_id, firma, turnos_restantes }
//
// Contrato:
//   1. Mientras LARSITO_ON no valga exactamente "true", el endpoint está cerrado y
//      responde 200 con {ok:false, error:"cerrado"}. Esa comprobación va la primera,
//      antes que ninguna otra, para que se pueda desplegar sin claves y sin gasto.
//   2. Con el flag activo exige el mismo muro que el resto de NEXO PASS: cookie de
//      sesión firmada y compra activa comprobada en servidor, no solo en la cookie.
//   3. Dos topes distintos. Uno por compra (60 sesiones al día, tabla norsk_uso con
//      tipo "larsito", separado del tipo "api" para que practicar preguntas no queme
//      la cuota de conversación ni al revés) y uno global del día para todo el
//      producto (tabla norsk_uso_global), que es el que protege del gasto agregado
//      en la API de voz si un día hay una avalancha.
//   4. La respuesta lleva una firma JWT corta (15 minutos, uso "larsito") que el
//      cliente presenta para abrir la sesión de voz. La clave de ElevenLabs no sale
//      de este servidor en ningún caso: aquí solo viaja el identificador del agente.

import { readSessionCookie, compraActiva, tickUso, sbRpc, jwtSign } from "./_norsk_lib.js";

// Sesiones de conversación por compra y día. Una sesión larga cuesta más que una
// pregunta de test, así que el tope es bastante más bajo que el de norsk-preguntas.
const TOPE_DIARIO = 60;

// Vida de la firma que abre la sesión de voz. Corta a propósito: es un permiso de
// entrada, no una sesión. Si el usuario tarda, pide otra.
const FIRMA_MINUTOS = 15;

// Reintento con espera corta, igual que en norsk-preguntas: un hipo transitorio de
// una RPC no debe echar a un comprador legítimo. Devuelve null si las tres tentativas
// fallan, y quien llama decide (aquí siempre: fail-open, se sirve igualmente).
async function contarConReintento(etiqueta, fn) {
  for (let intento = 0; intento < 3; intento++) {
    try { return await fn(); }
    catch (e) {
      if (intento === 2) { console.error(`larsito-sesion ${etiqueta} (fail-open)`, e); return null; }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

export default async function handler(req, res) {
  // Interruptor general. Va antes de todo: sin claves de voz este endpoint no hace
  // nada y tiene que ser inofensivo, no dar un 500 ni filtrar si hay compra o no.
  if (process.env.LARSITO_ON !== "true") {
    res.status(200).json({
      ok: false,
      error: "cerrado",
      mensaje: "Larsito todavía no está abierto.",
    });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "metodo" }); return; }

  const sesion = readSessionCookie(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }

  let compra;
  try { compra = await compraActiva(sesion.sub); } catch (e) {
    console.error("larsito-sesion compra", e);
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  // Tope por compra. Si la RPC no responde ni al tercer intento se sirve igualmente
  // (fail-open) porque el usuario ya pagó: bloquearlo es peor que un rato sin tope.
  // El tope real se restablece en cuanto Supabase vuelve a responder.
  const usos = await contarConReintento("uso", () => tickUso(compra.id, "larsito"));
  if (usos !== null && usos > TOPE_DIARIO) {
    res.status(429).json({
      ok: false,
      error: "limite",
      mensaje: `Has hecho ${TOPE_DIARIO} conversaciones hoy. Mañana vuelves a tener todas. Descansar entre sesiones también es estudiar.`,
    });
    return;
  }

  // Tope global del día para todo el producto. Es la red que protege la factura de
  // la API de voz. Mismo criterio fail-open: si Supabase no contesta, no se bloquea
  // a quien ha pagado, se registra el fallo y se sirve.
  const topeGlobal = parseInt(process.env.LARSITO_TOPE_GLOBAL || "2000", 10);
  const global = await contarConReintento("global", () => sbRpc("norsk_incr_global", { p_tipo: "larsito" }));
  if (global !== null && Number(global) > topeGlobal) {
    res.status(429).json({
      ok: false,
      error: "saturado",
      mensaje: "Larsito está a tope de conversaciones por hoy. Prueba mañana, que vuelve entero.",
    });
    return;
  }

  const secreto = process.env.NORSK_JWT_SECRET;
  if (!secreto) {
    console.error("larsito-sesion falta NORSK_JWT_SECRET");
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }

  const exp = Math.floor(Date.now() / 1000) + FIRMA_MINUTOS * 60;
  const firma = jwtSign({ sub: compra.id, exp, uso: "larsito" }, secreto);

  res.status(200).json({
    ok: true,
    agente_id: process.env.LARSITO_AGENT_ID || null,
    firma,
    // null cuando la cuenta no se pudo leer (fail-open): el cliente lo trata como
    // "no lo sé", no como cero.
    turnos_restantes: usos === null ? null : Math.max(0, TOPE_DIARIO - usos),
    expira_en: exp,
  });
}
