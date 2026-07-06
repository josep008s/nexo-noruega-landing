// Sirve preguntas del banco a compradores con acceso activo. El muro real de NEXO NORSK.
// GET ?modo=ping                          -> comprueba acceso (sin gastar cuota)
// GET ?modo=practica&leccion=<1-12>       -> 10 preguntas aleatorias (de la lección, o de todo)
// GET ?modo=practica&ids=CODIGO,CODIGO    -> repetir falladas (máx 20)
// GET ?modo=simulacro&examen=statsborger  -> 36 preguntas (4 piloto), estratificadas por módulo
// GET ?modo=simulacro&examen=samfunns     -> 38 preguntas (4 piloto)
//
// Nunca existe un endpoint que devuelva el banco entero: máximo 38 por llamada,
// rate limit persistente de 120 peticiones/día por compra (tabla norsk_uso).

import { readSessionCookie, compraActiva, tickUso, sbRpc, sbSelect } from "./_norsk_lib.js";

// Reparto por módulo (proporcional al peso del banco 26/37/37).
const SIMULACROS = {
  statsborger: { total: 36, piloto: 4, porModulo: { 1: 9, 2: 13, 3: 14 } },
  samfunns: { total: 38, piloto: 4, porModulo: { 1: 10, 2: 14, 3: 14 } },
};

const CAMPOS = "codigo,modulo,leccion,tema,pregunta_no,pregunta_es,opciones_no,opciones_es,correcta,explicacion_es,fuente,nivel";

function barajar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default async function handler(req, res) {
  const sesion = readSessionCookie(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }

  let compra;
  try { compra = await compraActiva(sesion.sub); } catch (e) {
    console.error("norsk-preguntas compra", e);
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  // Comprobación de acceso sin coste de cuota (la app la usa al arrancar).
  if ((req.query || {}).modo === "ping") {
    res.status(200).json({ ok: true, modo: "ping", plan: compra.plan, expires_at: compra.expires_at });
    return;
  }

  // Rate limit con reintento: un hipo transitorio de la RPC no debe echar a un
  // comprador legítimo. Se reintenta 2 veces; si aún falla (Supabase caído), se
  // sirve igualmente (fail-open) porque el usuario ya pagó: bloquearlo es peor que
  // un rato sin tope. El tope real se restablece en cuanto la RPC responde.
  try {
    let usos = null;
    for (let intento = 0; intento < 3 && usos === null; intento++) {
      try { usos = await tickUso(compra.id, "api"); }
      catch (e) {
        if (intento === 2) { console.error("norsk-preguntas uso (fail-open)", e); break; }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (usos !== null && usos > 120) { res.status(429).json({ ok: false, error: "limite" }); return; }
  } catch (e) {
    console.error("norsk-preguntas uso", e);
  }

  const q = req.query || {};
  const modo = q.modo === "simulacro" ? "simulacro" : "practica";

  try {
    if (modo === "practica") {
      if (q.ids) {
        const codigos = String(q.ids).split(",").slice(0, 20).map((s) => s.trim()).filter((s) => /^[A-Z0-9-]{4,32}$/.test(s));
        if (!codigos.length) { res.status(400).json({ ok: false, error: "ids" }); return; }
        const rows = await sbSelect(`norsk_preguntas?codigo=in.(${codigos.map(encodeURIComponent).join(",")})&activa=is.true&select=${CAMPOS}`);
        res.status(200).json({ ok: true, modo, preguntas: barajar(rows) });
        return;
      }
      const leccion = /^([1-9]|1[0-2])$/.test(String(q.leccion || "")) ? parseInt(q.leccion, 10) : null;
      const rows = await sbRpc("norsk_muestra", { p_modulo: null, p_leccion: leccion, p_n: 10 });
      res.status(200).json({ ok: true, modo, leccion, preguntas: rows || [] });
      return;
    }

    const examen = Object.prototype.hasOwnProperty.call(SIMULACROS, q.examen) ? q.examen : "statsborger";
    const spec = SIMULACROS[examen];
    const bloques = await Promise.all(
      Object.entries(spec.porModulo).map(([mod, n]) =>
        sbRpc("norsk_muestra", { p_modulo: parseInt(mod, 10), p_leccion: null, p_n: n })),
    );
    const preguntas = barajar(bloques.flat().filter(Boolean));

    // Réplica del oficial: N preguntas piloto que no puntúan. El cliente corrige con esta marca
    // y la pantalla de resultados explica la mecánica (36/32/24 · 38/34/26).
    const idx = barajar(preguntas.map((_, i) => i)).slice(0, spec.piloto);
    idx.forEach((i) => { preguntas[i] = Object.assign({}, preguntas[i], { piloto: true }); });

    res.status(200).json({
      ok: true, modo, examen,
      mecanica: { total: spec.total, puntuables: spec.total - spec.piloto, aprobado: examen === "statsborger" ? 24 : 26, minutos: 60 },
      preguntas,
    });
  } catch (e) {
    console.error("norsk-preguntas", e);
    res.status(500).json({ ok: false, error: "interno" });
  }
}
