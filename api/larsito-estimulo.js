// Entrega un estimulo EX una sola vez por compra y ruta.
// La RPC registra la exposicion en la misma transaccion que decide el codigo:
// si el navegador lo recibe, ya cuenta como mostrado, incluso si abandona.

import {
  compraActiva,
  readJsonBodyLimited,
  readSessionCookie,
  sbRpc,
} from "../server/shared/norsk-lib.mjs";

const MAX_BODY_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUTA = "norskproven-b1-v1";
const ESTIMULOS = Object.freeze({
  A: Object.freeze(["EX-A-01", "EX-A-02", "EX-A-03", "EX-A-04"]),
  B: Object.freeze(["EX-B-01", "EX-B-02", "EX-B-03", "EX-B-04"]),
  C: Object.freeze(["EX-C-01", "EX-C-02", "EX-C-03", "EX-C-04"]),
});

function primeraFila(valor) {
  return Array.isArray(valor) ? valor[0] || null : valor || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (process.env.LARSITO_ON !== "true"
      || process.env.LARSITO_CONSUMER_READY !== "true"
      || process.env.LARSITO_AGENT_PRIVACY_READY !== "true") {
    res.status(200).json({ ok: false, error: "cerrado" });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }
  if (!process.env.NORSK_JWT_SECRET
      || !process.env.SUPABASE_URL
      || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  let body;
  try { body = await readJsonBodyLimited(req, MAX_BODY_BYTES); }
  catch (err) {
    res.status(err && err.status === 413 ? 413 : 400).json({ ok: false, error: err && err.code || "cuerpo" });
    return;
  }
  const tarea = typeof body.tarea === "string" ? body.tarea.toUpperCase() : "";
  const requestId = body.request_id;
  const attemptId = body.attempt_id;
  if (!ESTIMULOS[tarea]
      || !UUID.test(requestId || "")
      || !UUID.test(attemptId || "")
      || (body.ruta && body.ruta !== RUTA)) {
    res.status(400).json({ ok: false, error: "solicitud" });
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
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }
  if (!compra) {
    res.status(401).json({ ok: false, error: "caducado" });
    return;
  }

  let asignacion;
  try {
    asignacion = primeraFila(await sbRpc("norsk_mostrar_estimulo_ex", {
      p_compra: compra.id,
      p_ruta: RUTA,
      p_tarea: tarea,
      p_attempt_id: attemptId,
      p_request_id: requestId,
      p_candidatos: ESTIMULOS[tarea],
    }));
  } catch (err) {
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  if (!asignacion || asignacion.ok !== true || !ESTIMULOS[tarea].includes(asignacion.stimulus_id)) {
    if (asignacion && asignacion.error === "agotados") {
      res.status(409).json({ ok: false, error: "agotados" });
      return;
    }
    if (asignacion && asignacion.error === "solicitud") {
      res.status(400).json({ ok: false, error: "solicitud" });
      return;
    }
    if (asignacion && asignacion.error === "acceso") {
      res.status(401).json({ ok: false, error: "caducado" });
      return;
    }
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  res.status(200).json({
    ok: true,
    ruta: RUTA,
    tarea,
    stimulus_id: asignacion.stimulus_id,
    mostrado_en: asignacion.shown_at,
  });
}
