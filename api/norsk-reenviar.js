// Reenvío del magic link. Respuesta SIEMPRE constante (anti-enumeración).
// POST {email} -> {ok:true}

import { sbSelect, sbRpc, sendMagicLink, readBody } from "./_norsk_lib.js";

const RESPUESTA = { ok: true, mensaje: "Si ese correo tiene un acceso activo, el enlace está de camino." };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  const body = await readBody(req);
  const email = (body.email || "").toString().trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(200).json(RESPUESTA); return; }

  try {
    const rows = await sbSelect(
      `norsk_compras?email=eq.${encodeURIComponent(email)}&status=eq.activa&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,expires_at&order=expires_at.desc&limit=1`);
    if (rows.length) {
      // Máx 3 reenvíos/día por compra, en contador PROPIO (tipo "reenvio"): ni un
      // atacante con tu email puede quemarte la cuota de estudio, ni reenviar el
      // enlace te descuenta práctica. Peor caso de abuso: 3 correos/día a su dueño.
      const usos = await sbRpc("norsk_incr_uso", { p_compra: rows[0].id, p_tipo: "reenvio", p_coste: 1 });
      if (usos <= 3) {
        try {
          await sendMagicLink(email, rows[0].id, new Date(rows[0].expires_at).getTime());
        } catch (e) {
          // El correo no salió: se devuelve el crédito para no quemar la cuota.
          await sbRpc("norsk_incr_uso", { p_compra: rows[0].id, p_tipo: "reenvio", p_coste: -1 }).catch(() => {});
          throw e;
        }
      }
    }
  } catch (e) {
    console.error("norsk-reenviar", e);
  }
  res.status(200).json(RESPUESTA);
}
