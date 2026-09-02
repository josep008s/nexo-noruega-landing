// Contrato interno del consumidor de servidor de Larsito.
// Los archivos api/_* no se publican como endpoints. No hay ruta de navegador
// que marque una reserva como consumida: el puente de servidor importa
// consumirFirmaLarsito y exigir ok=true antes de abrir el recurso externo.

import { jwtVerify, sbRpc } from "./_norsk_lib.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verificarFirmaLarsito(firma, secreto) {
  const payload = jwtVerify(firma, secreto);
  if (!payload
      || payload.uso !== "larsito"
      || payload.aud !== "larsito-consumer"
      || !UUID.test(payload.sub || "")
      || !UUID.test(payload.reserva_id || "")
      || !UUID.test(payload.jti || "")) return null;
  return payload;
}

export async function consumirFirmaLarsito(firma, secreto) {
  const payload = verificarFirmaLarsito(firma, secreto);
  if (!payload) return { ok: false, error: "firma" };

  const consumida = await sbRpc("norsk_consumir_reserva_larsito", {
    p_reserva: payload.reserva_id,
    p_compra: payload.sub,
    p_tipo: "larsito",
    p_jti: payload.jti,
  });
  return consumida === true
    ? { ok: true, payload }
    : { ok: false, error: "usada_o_caducada" };
}

export async function registrarFalloFirmaLarsito(firma, secreto) {
  const payload = verificarFirmaLarsito(firma, secreto);
  if (!payload) return { ok: false, error: "firma" };

  const registrada = await sbRpc("norsk_registrar_fallo_larsito", {
    p_reserva: payload.reserva_id,
    p_compra: payload.sub,
    p_tipo: "larsito",
    p_jti: payload.jti,
  });
  return registrada === true
    ? { ok: true }
    : { ok: false, error: "usada_o_resuelta" };
}
