// Sirve el curso Norskprøven B1 a compradores con acceso activo. El muro del curso.
// GET ?modo=indice[&ruta=…]              -> lista de piezas sin cuerpo (sin gastar cuota)
// GET ?modo=pieza&codigo=M01[&ruta=…]    -> una pieza entera, con sus secciones en HTML
//
// ruta: norskproven-b1 (por defecto) o norsk-desde-cero-a2. Las dos viven en la
// misma tabla (migración 0008) y la compra tiene que dar derecho a esa ruta.
//
// Nunca existe un endpoint que devuelva el curso entero: una pieza por llamada, y
// rate limit persistente de 300 peticiones/día por compra (tabla norsk_uso, tipo
// "curso"). El contenido es de pago y se sirve a cuentagotas, no en bloque.
//
// La demo pública del curso no pasa por aquí: vive en data/norsk-curso-demo.json y
// la sirve el estático, porque es lo único que puede leerse sin haber pagado.

import { readSessionCookie, compraActiva, tickUso, sbSelect, accesoARuta, RUTAS_CURSO, RUTA_POR_DEFECTO } from "./_norsk_lib.js";

// Tope diario por compra para el tipo "curso". Contador propio, separado del de
// práctica ("api") y del de Larsito: leer una lección no debe quemar la cuota de
// los simulacros ni al revés.
const TOPE_DIARIO = 300;

// Formato del código de pieza. Coincide con el que valida el exportador, y se
// comprueba aquí antes de tocar Supabase para no montar una query con basura.
const CODIGO_VALIDO = /^[A-Z0-9_-]{3,40}$/;

const CAMPOS_INDICE = "codigo,tipo,titulo,orden";
const CAMPOS_PIEZA = "codigo,tipo,titulo,orden,meta,secciones,palabras";

export default async function handler(req, res) {
  const sesion = readSessionCookie(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }

  let compra;
  try { compra = await compraActiva(sesion.sub); } catch (e) {
    console.error("norsk-curso compra", e);
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  const q = req.query || {};
  const modo = q.modo === "pieza" ? "pieza" : "indice";
  const ruta = q.ruta ? String(q.ruta) : RUTA_POR_DEFECTO;
  if (!RUTAS_CURSO.includes(ruta)) { res.status(400).json({ ok: false, error: "ruta" }); return; }
  let autorizada = false;
  try { autorizada = await accesoARuta(compra.id, ruta); } catch (e) {
    console.error("norsk-curso acceso a ruta", e);
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }
  if (!autorizada) { res.status(403).json({ ok: false, error: "ruta_no_incluida", ruta }); return; }
  const filtroRuta = `ruta=eq.${encodeURIComponent(ruta)}`;
  // Si la migración 0008 aún no está aplicada, la columna ruta no existe y
  // PostgREST responde 400. En ese caso, y solo para la ruta por defecto, se
  // repite la consulta sin el filtro: la B1 sigue sirviéndose como hasta ahora.
  async function selectCurso(query) {
    try { return await sbSelect(`norsk_curso?${filtroRuta}&${query}`); }
    catch (e) {
      if (ruta === RUTA_POR_DEFECTO && /\b400\b/.test(String(e && e.message))) return sbSelect(`norsk_curso?${query}`);
      throw e;
    }
  }

  // El índice no gasta cuota: la app lo pide al arrancar y cada vez que vuelve al
  // menú, igual que el modo=ping de norsk-preguntas.
  if (modo === "indice") {
    try {
      const rows = await selectCurso(`activa=is.true&select=${CAMPOS_INDICE}&order=orden.asc`);
      res.status(200).json({ ok: true, modo, ruta, piezas: rows || [] });
    } catch (e) {
      console.error("norsk-curso indice", e);
      res.status(500).json({ ok: false, error: "interno" });
    }
    return;
  }

  const codigo = String(q.codigo || "").trim().toUpperCase();
  if (!CODIGO_VALIDO.test(codigo)) { res.status(400).json({ ok: false, error: "codigo" }); return; }

  // Rate limit con reintento: un hipo transitorio de la RPC no debe echar a un
  // comprador legítimo. Se reintenta 2 veces; si aún falla (Supabase caído), se
  // sirve igualmente (fail-open) porque el usuario ya pagó: bloquearlo es peor que
  // un rato sin tope. El tope real se restablece en cuanto la RPC responde.
  try {
    let usos = null;
    for (let intento = 0; intento < 3 && usos === null; intento++) {
      try { usos = await tickUso(compra.id, "curso"); }
      catch (e) {
        if (intento === 2) { console.error("norsk-curso uso (fail-open)", e); break; }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (usos !== null && usos > TOPE_DIARIO) { res.status(429).json({ ok: false, error: "limite" }); return; }
  } catch (e) {
    console.error("norsk-curso uso", e);
  }

  try {
    const rows = await selectCurso(
      `codigo=eq.${encodeURIComponent(codigo)}&activa=is.true&select=${CAMPOS_PIEZA}&limit=1`);
    if (!rows || !rows.length) { res.status(404).json({ ok: false, error: "pieza" }); return; }
    res.status(200).json({ ok: true, modo, ruta, pieza: rows[0] });
  } catch (e) {
    console.error("norsk-curso pieza", e);
    res.status(500).json({ ok: false, error: "interno" });
  }
}
