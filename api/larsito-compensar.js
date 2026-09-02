// Reintenta una sola vez el registro de fallo de una reserva de TTS cuando el
// servidor no pudo confirmarlo. Devuelve la cuota de compra, pero conserva el
// contador global y el de riesgo para impedir bucles de proveedor fallido.
// POST {token} -> {ok:true, compensada:boolean}

import {
  readJsonBodyLimited,
  readSessionCookie,
  jwtVerify,
  sbRpc,
} from "../server/shared/norsk-lib.mjs";

const MAX_BODY_BYTES = 2 * 1024;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }

  const secreto = process.env.NORSK_JWT_SECRET;
  if (!secreto) {
    console.error("larsito-compensar configuracion incompleta");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const sesion = readSessionCookie(req);
  if (!sesion) {
    res.status(401).json({ ok: false, error: "acceso" });
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

  const token = typeof body.token === "string" ? body.token : "";
  const payload = jwtVerify(token, secreto);
  if (!payload
      || payload.uso !== "larsito_compensar"
      || payload.tipo !== "larsito_tts"
      || payload.sub !== sesion.sub
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.reserva || "")
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.jti || "")) {
    res.status(400).json({ ok: false, error: "token" });
    return;
  }

  try {
    const compensada = await sbRpc("norsk_registrar_fallo_larsito", {
      p_reserva: payload.reserva,
      p_compra: payload.sub,
      p_tipo: payload.tipo,
      p_jti: payload.jti,
    });
    res.status(200).json({ ok: true, compensada: compensada === true });
  } catch (err) {
    console.error("larsito-compensar no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
  }
}
