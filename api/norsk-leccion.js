// Sirve lecciones del curso. La lección pública (L0) se sirve sin cookie;
// el resto exige compra activa.
// GET ?slug=<slug>  |  GET (sin slug) -> índice de lecciones (título/resumen, sin cuerpo)

import { readSessionCookie, compraActiva, sbSelect } from "../server/shared/norsk-lib.mjs";

export default async function handler(req, res) {
  const q = req.query || {};
  const slug = typeof q.slug === "string" && /^[a-z0-9-]{2,60}$/.test(q.slug) ? q.slug : null;

  try {
    if (!slug) {
      const rows = await sbSelect("norsk_lecciones?select=slug,orden,modulo,titulo,resumen,publica&order=orden.asc");
      res.status(200).json({ ok: true, lecciones: rows });
      return;
    }

    const rows = await sbSelect(`norsk_lecciones?slug=eq.${encodeURIComponent(slug)}&select=slug,orden,modulo,titulo,resumen,cuerpo_html,vocab,publica`);
    if (!rows.length) { res.status(404).json({ ok: false, error: "no-existe" }); return; }
    const leccion = rows[0];

    if (!leccion.publica) {
      const sesion = readSessionCookie(req);
      const compra = sesion ? await compraActiva(sesion.sub) : null;
      if (!compra) { res.status(401).json({ ok: false, error: "acceso" }); return; }
    }

    res.status(200).json({ ok: true, leccion });
  } catch (e) {
    console.error("norsk-leccion", e);
    res.status(500).json({ ok: false, error: "interno" });
  }
}
