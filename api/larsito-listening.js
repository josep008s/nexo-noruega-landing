// Sirve ejercicios de comprensión oral de Larsito a compradores con acceso activo.
// GET ?nivel=A2|B1&tema=<slug opcional>  -> hasta 10 ejercicios con audio firmado
//
// Contrato:
//   1. Mismo interruptor que larsito-sesion: mientras LARSITO_ON no valga "true"
//      responde 200 con {ok:false, error:"cerrado"} y no toca nada más.
//   2. Con el flag activo, mismo muro que el resto de NEXO PASS: cookie de sesión
//      firmada, compra activa comprobada en servidor y cuota diaria (tipo "larsito").
//   3. Nunca existe una llamada que devuelva el banco entero: máximo 10 ejercicios
//      por petición, igual que en norsk-preguntas. El contenido es de pago y se sirve
//      a cuentagotas, no en bloque.
//   4. El audio no se sirve por URL pública. Cada mp3 vive en un bucket privado de
//      Supabase Storage y se entrega con una URL firmada de una hora, que caduca sola.

import { readSessionCookie, compraActiva, tickUso, sbSelect } from "./_norsk_lib.js";

// Tope duro por llamada. Aunque el cliente pida más, aquí se corta.
const MAX_POR_LLAMADA = 10;

// Vida de la URL firmada del audio, en segundos. Una hora sobra para escuchar un
// ejercicio varias veces y es lo bastante corta como para que compartir el enlace
// no sirva de mucho.
const TTL_AUDIO = 3600;

const CAMPOS = "codigo,nivel,tema,titulo,duracion_s,audio_path,preguntas,transcript_no,transcript_es";

// Firma una URL temporal contra el bucket privado norsk-audio. Devuelve la URL
// absoluta lista para el <audio> del cliente.
async function urlFirmada(path, segundos) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  // El path puede tener carpetas: se codifica segmento a segmento para no romper
  // las barras ni dejar pasar caracteres raros.
  const seguro = String(path).split("/").map(encodeURIComponent).join("/");
  const r = await fetch(`${url}/storage/v1/object/sign/norsk-audio/${seguro}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ expiresIn: segundos }),
  });
  if (!r.ok) throw new Error(`storage sign ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (!json || !json.signedURL) throw new Error("storage sign sin signedURL");
  return `${url}/storage/v1${json.signedURL}`;
}

export default async function handler(req, res) {
  // Interruptor general, antes que ninguna otra comprobación.
  if (process.env.LARSITO_ON !== "true") {
    res.status(200).json({
      ok: false,
      error: "cerrado",
      mensaje: "Larsito todavía no está abierto.",
    });
    return;
  }

  const sesion = readSessionCookie(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }

  let compra;
  try { compra = await compraActiva(sesion.sub); } catch (e) {
    console.error("larsito-listening compra", e);
    res.status(500).json({ ok: false, error: "interno" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  // Rate limit con reintento: un hipo transitorio de la RPC no debe echar a un
  // comprador legítimo. Se reintenta 2 veces; si aún falla (Supabase caído), se
  // sirve igualmente (fail-open) porque el usuario ya pagó. Comparte el contador
  // "larsito" con las sesiones de conversación: es el mismo producto.
  try {
    let usos = null;
    for (let intento = 0; intento < 3 && usos === null; intento++) {
      try { usos = await tickUso(compra.id, "larsito"); }
      catch (e) {
        if (intento === 2) { console.error("larsito-listening uso (fail-open)", e); break; }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (usos !== null && usos > 60) { res.status(429).json({ ok: false, error: "limite" }); return; }
  } catch (e) {
    console.error("larsito-listening uso", e);
  }

  const q = req.query || {};

  const nivel = q.nivel ? String(q.nivel).toUpperCase() : null;
  if (nivel && nivel !== "A2" && nivel !== "B1") { res.status(400).json({ ok: false, error: "nivel" }); return; }

  const tema = q.tema ? String(q.tema).trim() : null;
  if (tema && !/^[a-z0-9-]{2,40}$/.test(tema)) { res.status(400).json({ ok: false, error: "tema" }); return; }

  try {
    const filtros = ["activa=is.true"];
    if (nivel) filtros.push(`nivel=eq.${nivel}`);
    if (tema) filtros.push(`tema=eq.${encodeURIComponent(tema)}`);
    const rows = await sbSelect(
      `norsk_listening?${filtros.join("&")}&select=${CAMPOS}&order=codigo.asc&limit=${MAX_POR_LLAMADA}`);

    // Se firma el audio de cada ejercicio en paralelo. Si la firma de uno falla, se
    // omite ese ejercicio y los demás siguen: un mp3 que falta no puede tumbar la
    // pantalla entera de comprensión oral.
    const firmados = await Promise.all((rows || []).map(async (ej) => {
      if (!ej.audio_path) {
        console.error(`larsito-listening ${ej.codigo}: sin audio_path`);
        return null;
      }
      try {
        const audio_url = await urlFirmada(ej.audio_path, TTL_AUDIO);
        const { audio_path, ...resto } = ej;
        return Object.assign({}, resto, { audio_url });
      } catch (e) {
        console.error(`larsito-listening firma ${ej.codigo}`, e);
        return null;
      }
    }));

    const ejercicios = firmados.filter(Boolean);
    res.status(200).json({ ok: true, nivel, tema, audio_ttl: TTL_AUDIO, ejercicios });
  } catch (e) {
    console.error("larsito-listening", e);
    res.status(500).json({ ok: false, error: "interno" });
  }
}
